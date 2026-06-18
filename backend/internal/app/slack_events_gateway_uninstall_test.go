package app

import (
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// uninstallTestEnv wires a Server with a miniredis-backed store, a fake-k8s
// PersonalAgentWriter seeded with one agent's Deployment+Service+Secret, and a
// matching agent record. Returns the server, the fake clientset, the record,
// and a cleanup.
func uninstallTestEnv(t *testing.T, signingSecret string) (*Server, *fake.Clientset, PersonalAgentRecord, func()) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{rdb: rdb}

	owner := "U0DEADAGENT"
	rec := PersonalAgentRecord{
		ID:                 "agent-dead-1",
		OwnerEmail:         "gone@example.com",
		OwnerSlackUserID:   owner,
		DisplayName:        "Ghost",
		SlackAppID:         "A0GHOST",
		SlackSigningSecret: signingSecret,
		ServiceName:        personalAgentResourceName(owner),
		ServiceNamespace:   "personal-agents",
		ServicePort:        8080,
		Status:             "installed",
	}
	if err := store.CreatePersonalAgent(context.Background(), rec); err != nil {
		t.Fatalf("CreatePersonalAgent: %v", err)
	}

	name := personalAgentResourceName(owner)
	cs := fake.NewSimpleClientset(
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "personal-agents"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "personal-agents"}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: personalAgentSecretName(owner), Namespace: "personal-agents"}},
	)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, store: store}

	return srv, cs, rec, func() { _ = rdb.Close(); mr.Close() }
}

func uninstallBody(appID string) []byte {
	return []byte(`{"type":"event_callback","api_app_id":"` + appID + `","event":{"type":"app_uninstalled"}}`)
}

func deploymentExists(cs *fake.Clientset, owner string) bool {
	_, err := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), personalAgentResourceName(owner), metav1.GetOptions{})
	return err == nil
}

func TestGatewayUninstall_ValidSignatureDeprovisions(t *testing.T) {
	const secret = "test-signing-secret-abc123"
	srv, cs, rec, cleanup := uninstallTestEnv(t, secret)
	defer cleanup()

	body := uninstallBody(rec.SlackAppID)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req := httptest.NewRequest(http.MethodPost, "/v1/slack/events", strings.NewReader(string(body)))
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", signSlack(secret, ts, body))
	rw := httptest.NewRecorder()

	srv.handleSlackEventsGateway(rw, req)

	if rw.Code != http.StatusOK {
		t.Fatalf("expected 200 ack, got %d", rw.Code)
	}
	// Teardown is async; poll briefly for the deployment to disappear.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !deploymentExists(cs, rec.OwnerSlackUserID) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if deploymentExists(cs, rec.OwnerSlackUserID) {
		t.Fatal("deployment still present — deprovision did not run")
	}
	// Store record gone too.
	if _, err := srv.store.GetPersonalAgentByAppID(context.Background(), rec.SlackAppID); err == nil {
		t.Fatal("store record still present after deprovision")
	}
}

func TestGatewayUninstall_InvalidSignatureRejected(t *testing.T) {
	const secret = "test-signing-secret-abc123"
	srv, cs, rec, cleanup := uninstallTestEnv(t, secret)
	defer cleanup()

	body := uninstallBody(rec.SlackAppID)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req := httptest.NewRequest(http.MethodPost, "/v1/slack/events", strings.NewReader(string(body)))
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", signSlack("WRONG-secret", ts, body))
	rw := httptest.NewRecorder()

	srv.handleSlackEventsGateway(rw, req)

	if rw.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on bad signature, got %d", rw.Code)
	}
	// Give any (erroneously spawned) goroutine a moment, then assert nothing
	// was torn down.
	time.Sleep(50 * time.Millisecond)
	if !deploymentExists(cs, rec.OwnerSlackUserID) {
		t.Fatal("deployment was deleted on an UNVERIFIED uninstall — spoof guard failed")
	}
}

func TestDeprovisionPersonalAgent_TeardownIsIdempotent(t *testing.T) {
	srv, cs, rec, cleanup := uninstallTestEnv(t, "s")
	defer cleanup()
	ctx := context.Background()

	if err := srv.deprovisionPersonalAgent(ctx, rec.OwnerSlackUserID, &rec); err != nil {
		t.Fatalf("first deprovision: %v", err)
	}
	if deploymentExists(cs, rec.OwnerSlackUserID) {
		t.Fatal("deployment still present after deprovision")
	}
	// Second call (Slack retry shape) must not error even though everything is
	// already gone.
	if err := srv.deprovisionPersonalAgent(ctx, rec.OwnerSlackUserID, &rec); err != nil {
		t.Fatalf("second (idempotent) deprovision: %v", err)
	}
}

func TestListPersonalAgents(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	store := &Store{rdb: rdb}
	ctx := context.Background()

	for i, owner := range []string{"U1", "U2", "U3"} {
		rec := PersonalAgentRecord{
			ID:               "agent-" + strconv.Itoa(i),
			OwnerSlackUserID: owner,
			SlackAppID:       "A" + strconv.Itoa(i),
			DisplayName:      "Agent " + strconv.Itoa(i),
		}
		if err := store.CreatePersonalAgent(ctx, rec); err != nil {
			t.Fatalf("create %s: %v", owner, err)
		}
	}

	recs, err := store.ListPersonalAgents(ctx)
	if err != nil {
		t.Fatalf("ListPersonalAgents: %v", err)
	}
	// Exactly the 3 main records — the by-owner / by-app index keys must NOT
	// be picked up by the scan glob.
	if len(recs) != 3 {
		t.Fatalf("expected 3 records, got %d: %+v", len(recs), recs)
	}
	for _, r := range recs {
		if r.ID == "" || r.SlackAppID == "" {
			t.Fatalf("record parsed empty: %+v", r)
		}
	}
}

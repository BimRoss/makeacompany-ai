package app

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// newPersonalAgentTestServer builds a Server wired against an in-memory
// Redis with the personal-agents flag turned on. The optional
// adminAllowlist seed determines whether admin endpoints will accept
// the seeded admin token. Returns the server + a teardown.
func newPersonalAgentTestServer(t *testing.T, flagOn bool, adminAllowlist []string) (*Server, *miniredis.Miniredis, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	s := &Server{
		cfg: Config{
			PersonalAgentsEnabled: flagOn,
			AdminSignInAllowlist:  adminAllowlist,
			AdminSessionTTLSec:    3600,
		},
		store: &Store{rdb: rdb},
		log:   log.New(io.Discard, "", 0),
		mux:   http.NewServeMux(),
	}
	s.mux.HandleFunc("/v1/portal/agents", s.handlePortalAgents)
	s.mux.HandleFunc("/v1/portal/agents/", s.handlePortalAgents)
	s.mux.HandleFunc("/v1/admin/personal-agents", s.handleAdminPersonalAgents)
	return s, srv, func() {
		_ = rdb.Close()
		srv.Close()
	}
}

// seedPortalSession creates a portal session + the matching user
// profile with a linked Slack user id, so subsequent handler calls
// with the returned bearer authenticate as ownerUserID.
func seedPortalSession(t *testing.T, st *Store, email, ownerUserID string) string {
	t.Helper()
	ctx := context.Background()
	if err := st.UpsertUserProfileAfterWaitlist(ctx, email, "cus_test", "cs_test", "paid", "", ""); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	if err := st.UpsertUserProfileSlackID(ctx, email, ownerUserID); err != nil {
		t.Fatalf("seed slack id: %v", err)
	}
	token := "tok_" + ownerUserID
	if err := st.CreatePortalSession(ctx, token, email, "C0FAKETESTCH", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return token
}

func doJSONRequest(t *testing.T, s *Server, method, path, bearer string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = strings.NewReader(string(buf))
	}
	req := httptest.NewRequest(method, path, reader)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func TestPortalAgents_FlagOffReturns404(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, false, nil)
	defer done()
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("flag off: got %d, want 404", rec.Code)
	}
}

func TestPortalAgents_UnauthorizedWithoutBearer(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer: got %d, want 401", rec.Code)
	}
}

func TestPortalAgents_ForbiddenWhenProfileMissingSlackID(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	ctx := context.Background()
	// Seed profile + portal session, but no slack id linked.
	_ = s.store.UpsertUserProfileAfterWaitlist(ctx, "grant@example.com", "cus_x", "cs_y", "paid", "", "")
	token := "tok_no_slack"
	_ = s.store.CreatePortalSession(ctx, token, "grant@example.com", "C0FAKETESTCH", time.Now().UTC().Add(time.Hour))

	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", token, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("no slack id: got %d, want 403", rec.Code)
	}
}

func TestPortalAgents_CreateGetListDelete(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")

	// Empty list to start.
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list (empty): got %d, want 200", rec.Code)
	}
	var listed portalAgentsListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed.Agents) != 0 {
		t.Fatalf("expected 0 agents, got %d", len(listed.Agents))
	}

	// Create.
	rec = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var created portalAgentResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.Slug != "bart" || created.DisplayName != "Bart" || created.OwnerUserID != "U0APBT3364D" {
		t.Fatalf("created identity drift: %+v", created)
	}
	if created.GoogleConnected {
		t.Fatal("GoogleConnected should be false on fresh create")
	}

	// Get by slug.
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/bart", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: got %d, want 200", rec.Code)
	}

	// List shows it.
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", token, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Agents) != 1 || listed.Agents[0].Slug != "bart" {
		t.Fatalf("expected 1 agent named bart, got %+v", listed.Agents)
	}

	// Delete.
	rec = doJSONRequest(t, s, http.MethodDelete, "/v1/portal/agents/bart", token, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: got %d, want 204", rec.Code)
	}

	// Gone.
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/bart", token, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("get after delete: got %d, want 404", rec.Code)
	}
}

func TestPortalAgents_CreateRejectsInvalidName(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "!"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid name: got %d, want 400", rec.Code)
	}
}

func TestPortalAgents_CreateRejectsCollision(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	tokA := seedPortalSession(t, s.store, "a@example.com", "U0OWNERAAAA")
	tokB := seedPortalSession(t, s.store, "b@example.com", "U0OWNERBBBB")

	if rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", tokA, portalAgentRequest{Name: "Bart"}); rec.Code != http.StatusCreated {
		t.Fatalf("first create: got %d", rec.Code)
	}
	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", tokB, portalAgentRequest{Name: "Bart"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("second create: got %d, want 409", rec.Code)
	}
}

func TestPortalAgents_OwnershipIsolation(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	tokA := seedPortalSession(t, s.store, "a@example.com", "U0OWNERAAAA")
	tokB := seedPortalSession(t, s.store, "b@example.com", "U0OWNERBBBB")

	// A creates bart.
	if rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", tokA, portalAgentRequest{Name: "Bart"}); rec.Code != http.StatusCreated {
		t.Fatalf("A create: got %d", rec.Code)
	}

	// B's list should be empty.
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents", tokB, nil)
	var listed portalAgentsListResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if len(listed.Agents) != 0 {
		t.Fatalf("B should not see A's agent: %+v", listed.Agents)
	}

	// B tries to GET A's agent — 404, not 403 (don't leak existence).
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/bart", tokB, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("B get A's agent: got %d, want 404", rec.Code)
	}

	// B tries to DELETE A's agent — 404; A's agent must survive.
	rec = doJSONRequest(t, s, http.MethodDelete, "/v1/portal/agents/bart", tokB, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("B delete A's agent: got %d, want 404", rec.Code)
	}
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/bart", tokA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("A's agent should survive B's delete attempt: got %d", rec.Code)
	}
}

func TestPortalAgents_MalformedSlugIs404(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")

	// Slug with slash → 404 (handler doesn't accept subpaths).
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/bart/subpath", token, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("subpath: got %d, want 404", rec.Code)
	}

	// Slug with bad chars (uppercase) → 404.
	rec = doJSONRequest(t, s, http.MethodGet, "/v1/portal/agents/BART", token, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("uppercase slug: got %d, want 404", rec.Code)
	}
}

func TestAdminPersonalAgents_FlagOffReturns404(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, false, []string{"admin@example.com"})
	defer done()
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/admin/personal-agents", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("flag off: got %d, want 404", rec.Code)
	}
}

func TestAdminPersonalAgents_UnauthorizedWithoutAdminSession(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, []string{"admin@example.com"})
	defer done()
	rec := doJSONRequest(t, s, http.MethodGet, "/v1/admin/personal-agents", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no admin bearer: got %d, want 401", rec.Code)
	}
}

func TestAdminPersonalAgents_ListsAcrossOwners(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, []string{"admin@example.com"})
	defer done()
	ctx := context.Background()

	// Seed agents directly via store (admin path doesn't need portal session).
	_ = s.store.CreatePersonalAgent(ctx, "bart", "U0OWNERAAAA", "Bart")
	_ = s.store.CreatePersonalAgent(ctx, "zelda", "U0OWNERBBBB", "Zelda")

	// Mint an admin session for an allowlisted email.
	adminToken := "admin_tok_1"
	if err := s.store.CreateAdminSession(ctx, adminToken, "admin@example.com", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatalf("seed admin session: %v", err)
	}

	rec := doJSONRequest(t, s, http.MethodGet, "/v1/admin/personal-agents", adminToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin list: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var listed portalAgentsListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed.Agents) != 2 {
		t.Fatalf("expected 2 agents, got %d (%+v)", len(listed.Agents), listed.Agents)
	}
}

func TestPortalAgentSlackToken_WritesSecretAndBindsBotUser(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	cs := fake.NewSimpleClientset()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(cs)
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")

	if rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"}); rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d", rec.Code)
	}
	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", token, portalAgentSlackTokenRequest{
		BotToken:  "xoxb-1234567890-abcdef",
		AppToken:  "xapp-1234567890-abcdef",
		BotUserID: "U0BARTBOT01",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("paste: got %d, body=%s", rec.Code, rec.Body.String())
	}

	// Secret in the right namespace + name.
	got, err := cs.CoreV1().Secrets(PersonalAgentNamespace).Get(context.Background(), "personal-agent-bart-secrets", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("secret get: %v", err)
	}
	if string(got.Data["slack_bot_token"]) != "xoxb-1234567890-abcdef" {
		t.Errorf("bot token not persisted")
	}

	// Reverse index now resolves bot user → slug.
	slug, err := s.store.LookupPersonalAgentByBotUser(context.Background(), "U0BARTBOT01")
	if err != nil || slug != "bart" {
		t.Fatalf("reverse index: slug=%q err=%v", slug, err)
	}
}

func TestPortalAgentSlackToken_RejectsMalformedTokens(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(fake.NewSimpleClientset())
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", token, portalAgentSlackTokenRequest{
		BotToken:  "xapp-swapped",
		AppToken:  "xoxb-swapped",
		BotUserID: "U0BARTBOT01",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("swap: got %d, want 400", rec.Code)
	}
}

func TestPortalAgentSlackToken_404OnNotOwned(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(fake.NewSimpleClientset())
	tokA := seedPortalSession(t, s.store, "a@example.com", "U0OWNERAAAA")
	tokB := seedPortalSession(t, s.store, "b@example.com", "U0OWNERBBBB")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", tokA, portalAgentRequest{Name: "Bart"})

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", tokB, portalAgentSlackTokenRequest{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BARTBOT01",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("B paste on A's agent: got %d, want 404", rec.Code)
	}
}

func TestPortalAgentSlackToken_503WhenWriterDisabled(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	// Writer not injected → personalAgentSecrets is nil → Disabled() true.
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", token, portalAgentSlackTokenRequest{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BARTBOT01",
	})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled writer: got %d, want 503", rec.Code)
	}
}

func TestPortalAgentDelete_CleansUpSecret(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	cs := fake.NewSimpleClientset()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(cs)
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", token, portalAgentSlackTokenRequest{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BARTBOT01",
	})

	if rec := doJSONRequest(t, s, http.MethodDelete, "/v1/portal/agents/bart", token, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: got %d", rec.Code)
	}

	list, err := cs.CoreV1().Secrets(PersonalAgentNamespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list.Items) != 0 {
		t.Fatalf("expected secret cleaned up, got %d", len(list.Items))
	}
}

func TestPortalAgentConnectFinish_WritesSecretAndUpdatesTenant(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	cs := fake.NewSimpleClientset()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(cs)
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")

	// Create + paste-slack-token so the per-agent Secret exists.
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})
	if rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/slack-token", token, portalAgentSlackTokenRequest{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BARTBOT01",
	}); rec.Code != http.StatusNoContent {
		t.Fatalf("seed slack: %d", rec.Code)
	}

	body := map[string]any{
		"dcr": map[string]string{
			"clientId":     "client_dcr_id",
			"clientSecret": "client_dcr_secret",
		},
		"refreshToken": "1//rt-test",
		"scope":        "openid email",
		"googleEmail":  "grant@bimross.com",
		"googleSubject": "117654321",
	}
	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/connect/finish", token, body)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("connect/finish: %d, body=%s", rec.Code, rec.Body.String())
	}

	// Secret has google_* keys now.
	got, err := cs.CoreV1().Secrets(PersonalAgentNamespace).Get(context.Background(), "personal-agent-bart-secrets", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("secret get: %v", err)
	}
	if string(got.Data["google_refresh_token"]) != "1//rt-test" {
		t.Errorf("google_refresh_token: %q", got.Data["google_refresh_token"])
	}
	if string(got.Data["google_email"]) != "grant@bimross.com" {
		t.Errorf("google_email: %q", got.Data["google_email"])
	}

	// AgentTenant projection updated.
	pa, err := s.store.GetPersonalAgent(context.Background(), "bart")
	if err != nil {
		t.Fatalf("tenant: %v", err)
	}
	if !strings.EqualFold(pa.GoogleEmail, "grant@bimross.com") || pa.GoogleSubject != "117654321" {
		t.Fatalf("tenant google identity not set: %+v", pa)
	}
}

func TestPortalAgentConnectFinish_RejectsMissingRefreshToken(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(fake.NewSimpleClientset())
	token := seedPortalSession(t, s.store, "grant@bimross.com", "U0APBT3364D")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", token, portalAgentRequest{Name: "Bart"})

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/connect/finish", token, map[string]any{
		"dcr":          map[string]string{"clientId": "cid", "clientSecret": "csec"},
		"refreshToken": "",
		"googleEmail":  "x@y.z",
		"googleSubject": "12345",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing refresh: %d, want 400", rec.Code)
	}
}

func TestPortalAgentConnectFinish_404OnNotOwned(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, nil)
	defer done()
	s.personalAgentSecrets = newPersonalAgentSecretWriterFromClient(fake.NewSimpleClientset())
	tokA := seedPortalSession(t, s.store, "a@example.com", "U0OWNERAAAA")
	tokB := seedPortalSession(t, s.store, "b@example.com", "U0OWNERBBBB")
	_ = doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents", tokA, portalAgentRequest{Name: "Bart"})

	rec := doJSONRequest(t, s, http.MethodPost, "/v1/portal/agents/bart/connect/finish", tokB, map[string]any{
		"dcr":          map[string]string{"clientId": "c", "clientSecret": "s"},
		"refreshToken": "rt",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("B finish on A's agent: %d, want 404", rec.Code)
	}
}

func TestAdminPersonalAgents_NonGetIs405(t *testing.T) {
	s, _, done := newPersonalAgentTestServer(t, true, []string{"admin@example.com"})
	defer done()
	rec := doJSONRequest(t, s, http.MethodDelete, "/v1/admin/personal-agents", "", nil)
	// v1: admin is read-only; non-GET methods short-circuit before auth.
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE: got %d, want 405", rec.Code)
	}
}

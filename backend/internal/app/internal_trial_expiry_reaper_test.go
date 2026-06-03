package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newReaperTestServer(t *testing.T) (*Server, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	s := &Server{
		store: &Store{rdb: rdb},
		cfg: Config{
			BackendInternalServiceToken: "secret",
			AppBaseURL:                  "https://makeacompany.ai",
			TrialExpiryCheckoutURL:      "https://buy.stripe.com/test_base_plan",
		},
		log: log.New(os.Stderr, "", 0),
	}
	return s, mr
}

func seedTrialing(t *testing.T, s *Server, email, slackID string, expiresAt int64) {
	t.Helper()
	ctx := context.Background()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, email, "", expiresAt); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, email, slackID); err != nil {
		t.Fatal(err)
	}
}

func TestTrialExpiryReaper_picksOnlyTrialingExpiredUnenqueued(t *testing.T) {
	s, _ := newReaperTestServer(t)

	// Expired trial — should be enqueued.
	seedTrialing(t, s, "expired@example.com", "UEXP", 1)
	// Live trial — should NOT be enqueued.
	seedTrialing(t, s, "live@example.com", "ULIVE", time.Now().Add(72*time.Hour).Unix())
	// Already-enqueued expired trial — should NOT double-fire.
	seedTrialing(t, s, "already@example.com", "UALR", 1)
	if err := s.store.rdb.HSet(context.Background(), userProfileRedisKey("already@example.com"), "expiry_dm_enqueued_at", "2026-06-03T00:00:00Z").Err(); err != nil {
		t.Fatal(err)
	}
	// Free-lifetime user with expired trial timestamp lying around — must be ignored.
	seedTrialing(t, s, "freelife@example.com", "UFREE", 1)
	if err := s.store.MarkProfileFreeLifetime(context.Background(), "freelife@example.com"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/internal/trial-expiry-reaper", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalTrialExpiryReaper(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var body struct {
		OK       bool `json:"ok"`
		Scanned  int  `json:"scanned"`
		Enqueued int  `json:"enqueued"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Enqueued != 1 || body.Scanned != 1 {
		t.Fatalf("body: %+v, want ok=true scanned=1 enqueued=1", body)
	}

	// Queue should have exactly the one job, with the expected shape.
	items, err := s.store.rdb.LRange(context.Background(), JoanneExpiryDMQueueKey, 0, -1).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("queue len: %d, want 1 (items=%v)", len(items), items)
	}
	var job ExpiryDMJob
	if err := json.Unmarshal([]byte(items[0]), &job); err != nil {
		t.Fatalf("unmarshal job: %v (raw=%s)", err, items[0])
	}
	if job.SlackUserID != "UEXP" || job.Email != "expired@example.com" || job.StripeCheckoutURL != "https://buy.stripe.com/test_base_plan?client_reference_id=UEXP" {
		t.Fatalf("job: %+v", job)
	}

	// Profile must now carry expiry_dm_enqueued_at so a re-run is a no-op.
	row, err := s.store.UserProfileRowByEmail(context.Background(), "expired@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.ExpiryDMEnqueuedAt == "" {
		t.Fatalf("expiry_dm_enqueued_at not stamped: %+v", row)
	}

	// Second run: still 1 item on queue, scanned/enqueued both 0.
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/v1/internal/trial-expiry-reaper", nil)
	req2.Header.Set("Authorization", "Bearer secret")
	s.handleInternalTrialExpiryReaper(rr2, req2)
	var body2 struct {
		Scanned  int `json:"scanned"`
		Enqueued int `json:"enqueued"`
	}
	_ = json.Unmarshal(rr2.Body.Bytes(), &body2)
	if body2.Scanned != 0 || body2.Enqueued != 0 {
		t.Fatalf("re-run body: %+v, want scanned=0 enqueued=0", body2)
	}
	itemsAfter, _ := s.store.rdb.LRange(context.Background(), JoanneExpiryDMQueueKey, 0, -1).Result()
	if len(itemsAfter) != 1 {
		t.Fatalf("queue len after re-run: %d, want 1", len(itemsAfter))
	}
}

func TestTrialExpiryReaper_missingAuth401(t *testing.T) {
	s, _ := newReaperTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/trial-expiry-reaper", nil)
	rr := httptest.NewRecorder()
	s.handleInternalTrialExpiryReaper(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d, want 401", rr.Code)
	}
}

func TestTrialExpiryReaper_methodGuard(t *testing.T) {
	s, _ := newReaperTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/trial-expiry-reaper", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalTrialExpiryReaper(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: %d, want 405", rr.Code)
	}
}

func TestAppendClientReferenceID(t *testing.T) {
	cases := []struct {
		name, in, slack, want string
	}{
		{"no query", "https://buy.stripe.com/abc", "U123", "https://buy.stripe.com/abc?client_reference_id=U123"},
		{"existing query preserved", "https://buy.stripe.com/abc?utm=joanne", "U123", "https://buy.stripe.com/abc?client_reference_id=U123&utm=joanne"},
		{"existing client_reference_id overwritten", "https://buy.stripe.com/abc?client_reference_id=OLD", "U123", "https://buy.stripe.com/abc?client_reference_id=U123"},
		{"empty url unchanged", "", "U123", ""},
		{"empty slack unchanged", "https://buy.stripe.com/abc", "", "https://buy.stripe.com/abc"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := appendClientReferenceID(tc.in, tc.slack); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestTrialExpiryReaper_skipsUsersWithoutSlackID(t *testing.T) {
	s, _ := newReaperTestServer(t)
	ctx := context.Background()
	// Expired trial, but never linked to a Slack user — Joanne can't DM, so skip.
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "noslack@example.com", "", 1); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/trial-expiry-reaper", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalTrialExpiryReaper(rr, req)
	var body struct {
		Scanned  int `json:"scanned"`
		Enqueued int `json:"enqueued"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body.Scanned != 1 || body.Enqueued != 0 {
		t.Fatalf("body: %+v, want scanned=1 enqueued=0", body)
	}
}

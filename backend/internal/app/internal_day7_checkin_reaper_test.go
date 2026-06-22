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

func newDay7ReaperTestServer(t *testing.T) (*Server, *miniredis.Miniredis) {
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
		},
		log: log.New(os.Stderr, "", 0),
	}
	return s, mr
}

// seedSignupAt seeds a user_profile hash with a fixed signup_at and slack id so the day-7
// reaper can be exercised against deterministic timestamps. Bypasses stampSignupAtAndHSet
// because that helper writes time.Now and we need to control the clock.
func seedSignupAt(t *testing.T, s *Server, email, slackID string, signupAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if err := s.store.rdb.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"email":          email,
		"signup_at":      signupAt.UTC().Format(time.RFC3339),
		"slack_user_id":  slackID,
		"profile_updated_at": signupAt.UTC().Format(time.RFC3339),
	}).Err(); err != nil {
		t.Fatal(err)
	}
}

func TestDay7CheckinReaper_picksOnlyWithinWindow(t *testing.T) {
	s, _ := newDay7ReaperTestServer(t)
	now := time.Now().UTC()

	// Exactly 7 days old — eligible.
	seedSignupAt(t, s, "due@example.com", "UDUE", now.Add(-7*24*time.Hour))
	// 10 days old, still inside the 7d window past the boundary — eligible.
	seedSignupAt(t, s, "late@example.com", "ULATE", now.Add(-10*24*time.Hour))
	// 5 days old — too early, skip.
	seedSignupAt(t, s, "early@example.com", "UEARLY", now.Add(-5*24*time.Hour))
	// 60 days old — outside the recovery window (signup too old), skip. This is the
	// "no backfill of ancient users at deploy time" guard.
	seedSignupAt(t, s, "ancient@example.com", "UANCIENT", now.Add(-60*24*time.Hour))
	// 7 days old but no slack id — Joanne can't DM, skip.
	seedSignupAt(t, s, "noslack@example.com", "", now.Add(-7*24*time.Hour))
	// 7 days old but already enqueued — skip (idempotency guard).
	seedSignupAt(t, s, "already@example.com", "UALR", now.Add(-7*24*time.Hour))
	if err := s.store.rdb.HSet(context.Background(), userProfileRedisKey("already@example.com"), "day7_checkin_enqueued_at", "2026-06-15T00:00:00Z").Err(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/internal/day7-checkin-reaper", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalDay7CheckinReaper(rr, req)
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
	if !body.OK || body.Scanned != 2 || body.Enqueued != 2 {
		t.Fatalf("body: %+v, want ok=true scanned=2 enqueued=2", body)
	}

	items, err := s.store.rdb.LRange(context.Background(), JoanneDay7CheckinQueueKey, 0, -1).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("queue len: %d, want 2 (items=%v)", len(items), items)
	}
	emails := map[string]bool{}
	for _, raw := range items {
		var job Day7CheckinJob
		if err := json.Unmarshal([]byte(raw), &job); err != nil {
			t.Fatalf("unmarshal: %v raw=%s", err, raw)
		}
		if job.Reason != "day7_signup" {
			t.Errorf("job reason: %q, want day7_signup", job.Reason)
		}
		if job.SlackUserID == "" {
			t.Errorf("missing slack id in job: %+v", job)
		}
		emails[job.Email] = true
	}
	if !emails["due@example.com"] || !emails["late@example.com"] {
		t.Errorf("queue emails: %v, want due+late", emails)
	}

	// Idempotency guard: the eligible profiles must now carry the stamp.
	due, _ := s.store.UserProfileRowByEmail(context.Background(), "due@example.com")
	if due.Day7CheckinEnqueuedAt == "" {
		t.Errorf("day7_checkin_enqueued_at not stamped on due@example.com: %+v", due)
	}

	// Re-run: no new enqueues, queue length unchanged.
	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/v1/internal/day7-checkin-reaper", nil)
	req2.Header.Set("Authorization", "Bearer secret")
	s.handleInternalDay7CheckinReaper(rr2, req2)
	var body2 struct {
		Scanned  int `json:"scanned"`
		Enqueued int `json:"enqueued"`
	}
	_ = json.Unmarshal(rr2.Body.Bytes(), &body2)
	if body2.Scanned != 0 || body2.Enqueued != 0 {
		t.Fatalf("re-run body: %+v, want scanned=0 enqueued=0", body2)
	}
	itemsAfter, _ := s.store.rdb.LRange(context.Background(), JoanneDay7CheckinQueueKey, 0, -1).Result()
	if len(itemsAfter) != 2 {
		t.Fatalf("queue len after re-run: %d, want 2", len(itemsAfter))
	}
}

func TestDay7CheckinReaper_missingAuth401(t *testing.T) {
	s, _ := newDay7ReaperTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/day7-checkin-reaper", nil)
	rr := httptest.NewRecorder()
	s.handleInternalDay7CheckinReaper(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d, want 401", rr.Code)
	}
}

func TestDay7CheckinReaper_methodGuard(t *testing.T) {
	s, _ := newDay7ReaperTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/day7-checkin-reaper", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalDay7CheckinReaper(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: %d, want 405", rr.Code)
	}
}

func TestSetDay7CheckinResponse_roundTrip(t *testing.T) {
	s, _ := newDay7ReaperTestServer(t)
	ctx := context.Background()
	seedSignupAt(t, s, "reply@example.com", "UREPLY", time.Now().Add(-8*24*time.Hour))
	if err := s.store.SetDay7CheckinResponse(ctx, "reply@example.com", "named Sarah at sarah@x.com, invite sent"); err != nil {
		t.Fatal(err)
	}
	row, err := s.store.UserProfileRowByEmail(ctx, "reply@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.Day7CheckinResponse != "named Sarah at sarah@x.com, invite sent" {
		t.Fatalf("response round-trip: %q", row.Day7CheckinResponse)
	}
}

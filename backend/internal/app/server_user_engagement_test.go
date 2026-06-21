package app

import (
	"bytes"
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

func newEngagementTestServer(t *testing.T) (*Server, *miniredis.Miniredis) {
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
		cfg:   Config{BackendInternalServiceToken: "secret"},
		log:   log.New(os.Stderr, "", 0),
	}
	return s, mr
}

func TestIngestUserEngagement_Ross(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	body, _ := json.Marshal(map[string]any{
		"bot": "ross",
		"events": []map[string]any{
			{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339), "mentions_bot": true},
			{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339), "mentions_bot": false},
			{"workspace_id": "T1", "slack_user_id": "U2", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339), "mentions_bot": false},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/ingest-user-engagement", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalIngestUserEngagement(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("ingest status=%d body=%s", rr.Code, rr.Body.String())
	}
	summary, err := s.store.LoadUserEngagement(context.Background(), "U1")
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalMessages != 2 {
		t.Errorf("U1 total=%d want 2", summary.TotalMessages)
	}
	if summary.RossMessages != 2 {
		t.Errorf("U1 ross=%d want 2", summary.RossMessages)
	}
	if summary.RossMentions != 1 {
		t.Errorf("U1 ross_mentions=%d want 1", summary.RossMentions)
	}
	if summary.JoanneMessages != 0 {
		t.Errorf("U1 joanne=%d want 0", summary.JoanneMessages)
	}
}

func TestIngestUserEngagement_JoanneSeparateCounter(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
	})
	postBatch(t, s, "joanne", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339), "mentions_bot": true},
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
	})
	summary, _ := s.store.LoadUserEngagement(context.Background(), "U1")
	if summary.TotalMessages != 3 {
		t.Errorf("total=%d want 3", summary.TotalMessages)
	}
	if summary.RossMessages != 1 {
		t.Errorf("ross=%d want 1", summary.RossMessages)
	}
	if summary.JoanneMessages != 2 {
		t.Errorf("joanne=%d want 2", summary.JoanneMessages)
	}
	if summary.JoanneMentions != 1 {
		t.Errorf("joanne_mentions=%d want 1", summary.JoanneMentions)
	}
	if summary.RossMentions != 0 {
		t.Errorf("ross_mentions=%d want 0", summary.RossMentions)
	}
}

func TestIngestUserEngagement_PersonalAgent(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	// A personal agent reports its own DM: its own replies (UPA) and the
	// owner's inbound (UOWNER). Both land in the real per-user dedup store.
	postBatch(t, s, "personal-agent", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "UPA", "channel_id": "D1", "message_ts": "1.1", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
		{"workspace_id": "T1", "slack_user_id": "UPA", "channel_id": "D1", "message_ts": "1.2", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
		{"workspace_id": "T1", "slack_user_id": "UOWNER", "channel_id": "D1", "message_ts": "1.3", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
	})
	// The /admin Messages column reads the deduped per-user store
	// (TopUsersByMessages / LoadUserMessages), which is the path personal-agent
	// feeds. Both the PA's own row and the owner's row light up.
	pa, _ := s.store.LoadUserMessages(context.Background(), "UPA")
	if pa.TotalMessages != 2 {
		t.Errorf("UPA total=%d want 2", pa.TotalMessages)
	}
	owner, _ := s.store.LoadUserMessages(context.Background(), "UOWNER")
	if owner.TotalMessages != 1 {
		t.Errorf("UOWNER total=%d want 1", owner.TotalMessages)
	}
	// Legacy per-bot counters are skipped for personal-agent (no sprawl of
	// unread keys), so the canonical ross/joanne breakdown stays zero.
	legacy, _ := s.store.LoadUserEngagement(context.Background(), "UPA")
	if legacy.RossMessages != 0 || legacy.JoanneMessages != 0 {
		t.Errorf("UPA legacy counters ross=%d joanne=%d want 0/0", legacy.RossMessages, legacy.JoanneMessages)
	}
}

func TestIngestUserEngagement_BadBot(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	body, _ := json.Marshal(map[string]any{
		"bot":    "garth",
		"events": []map[string]any{{"workspace_id": "T1", "slack_user_id": "U1"}},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/ingest-user-engagement", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalIngestUserEngagement(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", rr.Code)
	}
}

func TestAdminUserEngagement_InternalServiceBearer(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	now := time.Now().UTC().Format(time.RFC3339)
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": now},
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": now},
	})

	topReq := httptest.NewRequest(http.MethodGet, "/v1/admin/user-engagement/top", nil)
	topReq.Header.Set("Authorization", "Bearer secret")
	topRR := httptest.NewRecorder()
	s.handleAdminUserEngagementTop(topRR, topReq)
	if topRR.Code != http.StatusOK {
		t.Fatalf("top status=%d body=%s", topRR.Code, topRR.Body.String())
	}

	oneReq := httptest.NewRequest(http.MethodGet, "/v1/admin/user-engagement/U1", nil)
	oneReq.SetPathValue("slackUserId", "U1")
	oneReq.Header.Set("Authorization", "Bearer secret")
	oneRR := httptest.NewRecorder()
	s.handleAdminUserEngagement(oneRR, oneReq)
	if oneRR.Code != http.StatusOK {
		t.Fatalf("single status=%d body=%s", oneRR.Code, oneRR.Body.String())
	}
}

func TestAdminUserEngagement_RejectsMissingAuth(t *testing.T) {
	// Test config has no admin allowlist (so adminAuthEnabled is false), so a
	// no-auth call hits the service-unavailable branch rather than 401. Either
	// is a rejection from Ross's perspective; what matters is that the wrong
	// path can't read engagement data.
	s, _ := newEngagementTestServer(t)
	topReq := httptest.NewRequest(http.MethodGet, "/v1/admin/user-engagement/top", nil)
	topRR := httptest.NewRecorder()
	s.handleAdminUserEngagementTop(topRR, topReq)
	if topRR.Code == http.StatusOK {
		t.Fatalf("top status=200 with no auth, want rejection")
	}
	oneReq := httptest.NewRequest(http.MethodGet, "/v1/admin/user-engagement/U1", nil)
	oneReq.SetPathValue("slackUserId", "U1")
	oneRR := httptest.NewRecorder()
	s.handleAdminUserEngagement(oneRR, oneReq)
	if oneRR.Code == http.StatusOK {
		t.Fatalf("single status=200 with no auth, want rejection")
	}
}

func TestAdminUserEngagement_RejectsWrongBearer(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	topReq := httptest.NewRequest(http.MethodGet, "/v1/admin/user-engagement/top", nil)
	topReq.Header.Set("Authorization", "Bearer wrong")
	topRR := httptest.NewRecorder()
	s.handleAdminUserEngagementTop(topRR, topReq)
	if topRR.Code == http.StatusOK {
		t.Fatalf("top status=200 with wrong bearer, want rejection")
	}
}

func TestIngestUserEngagement_AuthRequired(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	body, _ := json.Marshal(map[string]any{"bot": "ross", "events": []map[string]any{}})
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/ingest-user-engagement", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	s.handleInternalIngestUserEngagement(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rr.Code)
	}
}

func TestTopUsersByEngagement(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	now := time.Now().UTC().Format(time.RFC3339)
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "USmall", "channel_id": "C1", "occurred_at": now},
	})
	for i := 0; i < 5; i++ {
		postBatch(t, s, "ross", []map[string]any{
			{"workspace_id": "T1", "slack_user_id": "UBig", "channel_id": "C1", "occurred_at": now},
		})
	}
	for i := 0; i < 3; i++ {
		postBatch(t, s, "joanne", []map[string]any{
			{"workspace_id": "T1", "slack_user_id": "UMid", "channel_id": "C1", "occurred_at": now},
		})
	}
	top, err := s.store.TopUsersByEngagement(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(top) != 3 {
		t.Fatalf("len=%d want 3", len(top))
	}
	if top[0].SlackUserID != "UBig" || top[0].TotalMessages != 5 {
		t.Errorf("top[0]=%+v", top[0])
	}
	if top[1].SlackUserID != "UMid" || top[1].TotalMessages != 3 {
		t.Errorf("top[1]=%+v", top[1])
	}
	if top[2].SlackUserID != "USmall" || top[2].TotalMessages != 1 {
		t.Errorf("top[2]=%+v", top[2])
	}
}

func TestLoadUserEngagement_SparklineWindow(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
	})
	summary, err := s.store.LoadUserEngagement(context.Background(), "U1")
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Sparkline) != 30 {
		t.Fatalf("sparkline len=%d want 30", len(summary.Sparkline))
	}
	if summary.Sparkline[29].Messages != 1 {
		t.Errorf("today messages=%d want 1", summary.Sparkline[29].Messages)
	}
	if summary.Sparkline[0].Messages != 0 {
		t.Errorf("oldest day messages=%d want 0", summary.Sparkline[0].Messages)
	}
}

func TestLoadUserEngagement_UnknownReturnsEmpty(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	summary, err := s.store.LoadUserEngagement(context.Background(), "UGHOST")
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalMessages != 0 {
		t.Errorf("expected zero summary, got %+v", summary)
	}
	if len(summary.Sparkline) != 30 {
		t.Errorf("expected 30-day sparkline of zeros, got %d", len(summary.Sparkline))
	}
}

func TestBackfillUserEngagement_Idempotent(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	day := "2026-06-10"
	applied, err := s.store.BackfillUserEngagementDay(context.Background(), "ross", day, map[string]int{"U1": 5, "U2": 3})
	if err != nil {
		t.Fatal(err)
	}
	if !applied {
		t.Fatal("first run should apply")
	}
	// Re-apply with different counts; should skip and leave U1=5.
	applied2, err := s.store.BackfillUserEngagementDay(context.Background(), "ross", day, map[string]int{"U1": 99})
	if err != nil {
		t.Fatal(err)
	}
	if applied2 {
		t.Fatal("second run for same day must be skipped")
	}
	u1, _ := s.store.LoadUserEngagement(context.Background(), "U1")
	if u1.TotalMessages != 5 {
		t.Errorf("U1 total=%d want 5 (no double-count)", u1.TotalMessages)
	}
	if u1.RossMessages != 5 {
		t.Errorf("U1 ross=%d want 5", u1.RossMessages)
	}
}

func TestBackfillUserEngagement_LastSeenMonotonic(t *testing.T) {
	s, _ := newEngagementTestServer(t)
	// Live ingest sets last_seen_at to "today" implicitly.
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "occurred_at": time.Now().UTC().Format(time.RFC3339)},
	})
	before, _ := s.store.LoadUserEngagement(context.Background(), "U1")
	// Backfill an older day; last_seen_at must NOT roll back.
	_, err := s.store.BackfillUserEngagementDay(context.Background(), "ross", "2026-01-01", map[string]int{"U1": 1})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := s.store.LoadUserEngagement(context.Background(), "U1")
	if after.LastSeenAt != before.LastSeenAt {
		t.Errorf("last_seen_at rolled back: before=%s after=%s", before.LastSeenAt, after.LastSeenAt)
	}
}

func postBatch(t *testing.T, s *Server, bot string, events []map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"bot": bot, "events": events})
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/ingest-user-engagement", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalIngestUserEngagement(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("ingest status=%d body=%s", rr.Code, rr.Body.String())
	}
}

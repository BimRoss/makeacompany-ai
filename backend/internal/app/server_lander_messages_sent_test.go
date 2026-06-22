package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandleLanderMessagesSent_returnsTotalAndDailySeries(t *testing.T) {
	landerMessagesSentMemo = landerMessagesSentCache{}
	s, _ := newEngagementTestServer(t)
	ctx := context.Background()

	now := time.Now().UTC()
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "message_ts": "1.1", "occurred_at": now.Format(time.RFC3339)},
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "message_ts": "1.2", "occurred_at": now.Format(time.RFC3339)},
		{"workspace_id": "T1", "slack_user_id": "U2", "channel_id": "C1", "message_ts": "1.3", "occurred_at": now.Format(time.RFC3339)},
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/lander/messages-sent", nil)
	rr := httptest.NewRecorder()
	s.handleLanderMessagesSent(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got landerMessagesSentPayload
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Total != 3 {
		t.Fatalf("total=%d want 3", got.Total)
	}
	if len(got.Daily) != landerMessagesSentDays {
		t.Fatalf("daily len=%d want %d", len(got.Daily), landerMessagesSentDays)
	}
	last := got.Daily[len(got.Daily)-1]
	if last.Day != now.Format("2006-01-02") {
		t.Errorf("last day=%q want %q", last.Day, now.Format("2006-01-02"))
	}
	if last.Messages != 3 {
		t.Errorf("today's messages=%d want 3", last.Messages)
	}
	// Confirm the total is also reflected in the store directly.
	total, err := s.store.TotalMessages(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 {
		t.Fatalf("store total=%d want 3", total)
	}
}

func TestHandleLanderMessagesSent_emptyStateReturnsZeroSeries(t *testing.T) {
	landerMessagesSentMemo = landerMessagesSentCache{}
	s, _ := newEngagementTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/lander/messages-sent", nil)
	rr := httptest.NewRecorder()
	s.handleLanderMessagesSent(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got landerMessagesSentPayload
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Total != 0 {
		t.Errorf("total=%d want 0", got.Total)
	}
	if len(got.Daily) != landerMessagesSentDays {
		t.Errorf("daily len=%d want %d", len(got.Daily), landerMessagesSentDays)
	}
	for _, p := range got.Daily {
		if p.Messages != 0 {
			t.Errorf("day %s = %d, want 0", p.Day, p.Messages)
		}
	}
}

func TestHandleLanderMessagesSent_cachesAcrossCalls(t *testing.T) {
	landerMessagesSentMemo = landerMessagesSentCache{}
	s, _ := newEngagementTestServer(t)
	now := time.Now().UTC()
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U1", "channel_id": "C1", "message_ts": "1.1", "occurred_at": now.Format(time.RFC3339)},
	})
	// Prime the cache.
	req := httptest.NewRequest(http.MethodGet, "/v1/lander/messages-sent", nil)
	rr := httptest.NewRecorder()
	s.handleLanderMessagesSent(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("priming call status=%d", rr.Code)
	}
	// Mutate the store; second call should still return the cached value.
	postBatch(t, s, "ross", []map[string]any{
		{"workspace_id": "T1", "slack_user_id": "U2", "channel_id": "C1", "message_ts": "1.9", "occurred_at": now.Format(time.RFC3339)},
	})
	req2 := httptest.NewRequest(http.MethodGet, "/v1/lander/messages-sent", nil)
	rr2 := httptest.NewRecorder()
	s.handleLanderMessagesSent(rr2, req2)
	var got landerMessagesSentPayload
	if err := json.Unmarshal(rr2.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Total != 1 {
		t.Fatalf("cached total=%d want 1 (cache should mask the second ingest)", got.Total)
	}
}

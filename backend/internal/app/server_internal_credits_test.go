package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newCreditsTestServer(t *testing.T, gateEnabled bool) *Server {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &Server{
		store: &Store{rdb: rdb},
		cfg: Config{
			BackendInternalServiceToken: "secret",
			CreditGateEnabled:           gateEnabled,
			CreditInitialGrant:          100,
			AppBaseURL:                  "https://makeacompany.ai",
		},
		log: log.New(os.Stderr, "", 0),
	}
}

func linkSlackProfile(t *testing.T, s *Server, email, slackID string) {
	t.Helper()
	if err := s.store.UpsertUserProfileSlackID(context.Background(), email, slackID); err != nil {
		t.Fatal(err)
	}
}

func creditsCheck(t *testing.T, s *Server, slackID string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/credits?slack_user_id="+slackID, nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalCreditsCheck(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("check status %d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func creditsConsume(t *testing.T, s *Server, jsonBody string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/credits/consume", strings.NewReader(jsonBody))
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalCreditsConsume(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("consume status %d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestCreditsCheck_unauthorized(t *testing.T) {
	s := newCreditsTestServer(t, true)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/credits?slack_user_id=U1", nil)
	rr := httptest.NewRecorder()
	s.handleInternalCreditsCheck(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status %d want 401", rr.Code)
	}
}

func TestCreditsCheck_unknownUserFailsOpen(t *testing.T) {
	s := newCreditsTestServer(t, true)
	body := creditsCheck(t, s, "UNMAPPED")
	if body["allowed"] != true {
		t.Fatalf("allowed: %v", body["allowed"])
	}
	if body["reason"] != "unknown_user" {
		t.Fatalf("reason: %v", body["reason"])
	}
}

func TestCreditsCheck_gateDisabledNeverBlocks(t *testing.T) {
	s := newCreditsTestServer(t, false)
	linkSlackProfile(t, s, "u@example.com", "U1")
	// Drain the balance to zero.
	for i := 0; i < 100; i++ {
		creditsConsume(t, s, `{"slack_user_id":"U1"}`)
	}
	body := creditsCheck(t, s, "U1")
	if body["allowed"] != true {
		t.Fatalf("gate-off should allow: %v", body)
	}
	if body["reason"] != "gate_disabled" {
		t.Fatalf("reason: %v", body["reason"])
	}
}

func TestCreditsCheck_blocksAtZeroWhenGated(t *testing.T) {
	s := newCreditsTestServer(t, true)
	linkSlackProfile(t, s, "u@example.com", "U1")
	// Fresh user is allowed.
	if body := creditsCheck(t, s, "U1"); body["allowed"] != true || body["balance"].(float64) != 100 {
		t.Fatalf("fresh check: %v", body)
	}
	// Drain to zero.
	for i := 0; i < 100; i++ {
		creditsConsume(t, s, `{"slack_user_id":"U1"}`)
	}
	body := creditsCheck(t, s, "U1")
	if body["allowed"] != false {
		t.Fatalf("expected block at zero: %v", body)
	}
	if body["reason"] != "no_credits" {
		t.Fatalf("reason: %v", body["reason"])
	}
	if !strings.Contains(body["checkoutURL"].(string), "/billing") {
		t.Fatalf("checkoutURL: %v", body["checkoutURL"])
	}
}

func TestCreditsConsume_chargesAndRecordsTeam(t *testing.T) {
	s := newCreditsTestServer(t, true)
	linkSlackProfile(t, s, "u@example.com", "U1")
	body := creditsConsume(t, s, `{"slack_user_id":"U1","slack_team_id":"TEAM7"}`)
	if body["charged"] != true {
		t.Fatalf("charged: %v", body)
	}
	if body["balance"].(float64) != 99 {
		t.Fatalf("balance: %v", body["balance"])
	}
	row, err := s.store.UserProfileRowByEmail(context.Background(), "u@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.SlackTeamID != "TEAM7" {
		t.Fatalf("team: %q", row.SlackTeamID)
	}
}

func TestCreditsConsume_idempotencyKeyDedupes(t *testing.T) {
	s := newCreditsTestServer(t, true)
	linkSlackProfile(t, s, "u@example.com", "U1")
	first := creditsConsume(t, s, `{"slack_user_id":"U1","idempotency_key":"msg-1"}`)
	if first["charged"] != true || first["balance"].(float64) != 99 {
		t.Fatalf("first: %v", first)
	}
	second := creditsConsume(t, s, `{"slack_user_id":"U1","idempotency_key":"msg-1"}`)
	if second["charged"] != false {
		t.Fatalf("second should not charge: %v", second)
	}
	if second["reason"] != "duplicate" {
		t.Fatalf("reason: %v", second["reason"])
	}
	if second["balance"].(float64) != 99 {
		t.Fatalf("balance moved: %v", second["balance"])
	}
}

func TestCreditsConsume_unknownUserNoop(t *testing.T) {
	s := newCreditsTestServer(t, true)
	body := creditsConsume(t, s, `{"slack_user_id":"GHOST"}`)
	if body["charged"] != false || body["reason"] != "unknown_user" {
		t.Fatalf("unknown consume: %v", body)
	}
}

package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newUserStatusTestServer(t *testing.T) (*Server, *miniredis.Miniredis) {
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

func TestInternalUserStatus_unknownSlackUserDefaultsFreeLifetime(t *testing.T) {
	s, _ := newUserStatusTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/user-status?slack_user_id=UNKNOWN", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalUserStatus(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "free_lifetime" {
		t.Fatalf("status: %q, want free_lifetime", body["status"])
	}
}

func TestInternalUserStatus_trialingUserResolves(t *testing.T) {
	s, _ := newUserStatusTestServer(t)
	ctx := context.Background()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "trial@example.com", "", 2000000000); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "trial@example.com", "UTRIAL"); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/user-status?slack_user_id=UTRIAL", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalUserStatus(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["status"] != "trialing" {
		t.Fatalf("status: %q, want trialing", body["status"])
	}
}

func TestInternalUserStatus_expiredUserResolves(t *testing.T) {
	s, _ := newUserStatusTestServer(t)
	ctx := context.Background()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "exp@example.com", "", 1); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "exp@example.com", "UEXP"); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/user-status?slack_user_id=UEXP", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalUserStatus(rr, req)
	var body map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body["status"] != "expired" {
		t.Fatalf("status: %q, want expired", body["status"])
	}
}

func TestInternalUserStatus_missingAuth401(t *testing.T) {
	s, _ := newUserStatusTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/user-status?slack_user_id=U1", nil)
	rr := httptest.NewRecorder()
	s.handleInternalUserStatus(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d, want 401", rr.Code)
	}
}

func TestInternalUserStatus_missingSlackUserID400(t *testing.T) {
	s, _ := newUserStatusTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/user-status", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rr := httptest.NewRecorder()
	s.handleInternalUserStatus(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: %d, want 400", rr.Code)
	}
}

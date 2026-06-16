package app

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newPersonalAgentTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	st := &Store{rdb: rdb}
	return st, func() { _ = rdb.Close(); srv.Close() }
}

func TestPersonalAgent_CreateAndGet(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	rec := PersonalAgentRecord{
		ID:               "agent-1",
		OwnerEmail:       "grant@bimross.com",
		OwnerSlackUserID: "U0APBT3364D",
		DisplayName:      "Garth",
		SlackAppID:       "A0GARTH",
		SlackClientID:    "111.222",
		SlackSigningSecret: "sig",
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("CreatePersonalAgent: %v", err)
	}
	got, err := st.GetPersonalAgent(ctx, "agent-1")
	if err != nil {
		t.Fatalf("GetPersonalAgent: %v", err)
	}
	if got.OwnerEmail != "grant@bimross.com" {
		t.Errorf("OwnerEmail = %q", got.OwnerEmail)
	}
	if got.DisplayName != "Garth" {
		t.Errorf("DisplayName = %q", got.DisplayName)
	}
	if got.Status != PersonalAgentStatusPendingInstall {
		t.Errorf("Status = %q, want %q", got.Status, PersonalAgentStatusPendingInstall)
	}
	if got.CreatedAt == "" || got.UpdatedAt == "" {
		t.Errorf("timestamps not stamped: created=%q updated=%q", got.CreatedAt, got.UpdatedAt)
	}
}

func TestPersonalAgent_ByOwnerAndByAppID(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	rec := PersonalAgentRecord{
		ID: "agent-1", OwnerSlackUserID: "U1", SlackAppID: "A_APP1",
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("create: %v", err)
	}

	byOwner, err := st.GetPersonalAgentByOwner(ctx, "U1")
	if err != nil {
		t.Fatalf("GetPersonalAgentByOwner: %v", err)
	}
	if byOwner.ID != "agent-1" {
		t.Errorf("by-owner id = %q", byOwner.ID)
	}

	byApp, err := st.GetPersonalAgentByAppID(ctx, "A_APP1")
	if err != nil {
		t.Fatalf("GetPersonalAgentByAppID: %v", err)
	}
	if byApp.ID != "agent-1" {
		t.Errorf("by-app id = %q", byApp.ID)
	}

	if _, err := st.GetPersonalAgentByOwner(ctx, "UNOPE"); !errors.Is(err, redis.Nil) {
		t.Errorf("expected redis.Nil for missing owner, got %v", err)
	}
}

func TestPersonalAgent_OneAgentPerOwner(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"}); err != nil {
		t.Fatalf("first create: %v", err)
	}
	err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a2", OwnerSlackUserID: "U1", SlackAppID: "A2"})
	if err == nil {
		t.Fatal("expected second agent for same owner to be rejected")
	}
	if !errors.Is(err, ErrPersonalAgentExists) {
		t.Errorf("expected ErrPersonalAgentExists, got %v", err)
	}
}

func TestPersonalAgent_MarkInstalledAndSetService(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.MarkPersonalAgentInstalled(ctx, "a1"); err != nil {
		t.Fatalf("MarkInstalled: %v", err)
	}
	if err := st.SetPersonalAgentService(ctx, "a1", "personal-agents", "personal-agent-garth", 8080); err != nil {
		t.Fatalf("SetService: %v", err)
	}

	got, _ := st.GetPersonalAgent(ctx, "a1")
	if got.Status != PersonalAgentStatusInstalled {
		t.Errorf("Status = %q", got.Status)
	}
	if got.ServiceNamespace != "personal-agents" || got.ServiceName != "personal-agent-garth" || got.ServicePort != 8080 {
		t.Errorf("service fields wrong: %+v", got)
	}
}

func TestPersonalAgent_SetServiceRejectsBadInput(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()
	_ = st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"})

	if err := st.SetPersonalAgentService(ctx, "a1", "", "x", 8080); err == nil {
		t.Fatal("expected error on empty namespace")
	}
	if err := st.SetPersonalAgentService(ctx, "a1", "ns", "x", 0); err == nil {
		t.Fatal("expected error on zero port")
	}
}

func TestPersonalAgent_UpdateOnNonexistentReturnsNil(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	if err := st.UpdatePersonalAgentStatus(ctx, "doesnotexist", "failed"); !errors.Is(err, redis.Nil) {
		t.Errorf("expected redis.Nil for missing record, got %v", err)
	}
}

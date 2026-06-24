package app

import (
	"context"
	"errors"
	"log"
	"os"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newOwnerRequestTestServer(t *testing.T) *Server {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &Server{store: &Store{rdb: rdb}, cfg: Config{}, log: log.New(os.Stderr, "", 0)}
}

// TestPersonalAgentForOwnerRequest covers the four resolution cases the helper
// must get right (#651): empty agentId with one vs many agents, an owned
// agentId, and a not-owned agentId.
func TestPersonalAgentForOwnerRequest(t *testing.T) {
	s := newOwnerRequestTestServer(t)
	ctx := context.Background()

	// Owner U1 has one installed agent. A second owner U2 has a different agent
	// we use to prove cross-owner agentIds are rejected.
	if err := s.store.CreatePersonalAgent(ctx, installedAgent("a1", "U1", "A1")); err != nil {
		t.Fatalf("seed a1: %v", err)
	}
	if err := s.store.CreatePersonalAgent(ctx, installedAgent("other", "U2", "AO")); err != nil {
		t.Fatalf("seed other: %v", err)
	}

	// Empty agentId + exactly one agent → that agent (back-compat path).
	rec, err := s.personalAgentForOwnerRequest(ctx, nil, "U1", "")
	if err != nil {
		t.Fatalf("empty+one: unexpected err %v", err)
	}
	if rec.ID != "a1" {
		t.Errorf("empty+one: got %q, want a1", rec.ID)
	}

	// agentId owned → ok.
	rec, err = s.personalAgentForOwnerRequest(ctx, nil, "U1", "a1")
	if err != nil {
		t.Fatalf("owned id: unexpected err %v", err)
	}
	if rec.ID != "a1" {
		t.Errorf("owned id: got %q, want a1", rec.ID)
	}

	// agentId NOT owned (belongs to U2) → errPersonalAgentNotOwned.
	if _, err := s.personalAgentForOwnerRequest(ctx, nil, "U1", "other"); !errors.Is(err, errPersonalAgentNotOwned) {
		t.Errorf("not-owned id: got %v, want errPersonalAgentNotOwned", err)
	}

	// Add a second agent to U1, then empty agentId must error (ambiguous).
	if err := s.store.CreatePersonalAgent(ctx, installedAgent("a2", "U1", "A2")); err != nil {
		t.Fatalf("seed a2: %v", err)
	}
	if _, err := s.personalAgentForOwnerRequest(ctx, nil, "U1", ""); !errors.Is(err, errPersonalAgentIDRequired) {
		t.Errorf("empty+two: got %v, want errPersonalAgentIDRequired", err)
	}
	// But an explicit, owned agentId still resolves with two agents.
	rec, err = s.personalAgentForOwnerRequest(ctx, nil, "U1", "a2")
	if err != nil {
		t.Fatalf("explicit id with two agents: %v", err)
	}
	if rec.ID != "a2" {
		t.Errorf("explicit id: got %q, want a2", rec.ID)
	}
}

// TestPersonalAgentResolveStatusMapping locks the error→HTTP-status mapping so
// the handler responses stay stable.
func TestPersonalAgentResolveStatusMapping(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{redis.Nil, 404},
		{errPersonalAgentNotOwned, 404},
		{errPersonalAgentIDRequired, 400},
		{errors.New("boom"), 500},
	}
	for _, c := range cases {
		if got := personalAgentResolveStatus(c.err); got != c.want {
			t.Errorf("status(%v) = %d, want %d", c.err, got, c.want)
		}
	}
}

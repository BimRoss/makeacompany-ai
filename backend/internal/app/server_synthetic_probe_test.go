package app

import (
	"context"
	"fmt"
	"io"
	"log"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newProbeTestServer(t *testing.T) (*Server, *Store) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(srv.Close)

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	store := &Store{rdb: rdb}
	return &Server{store: store, log: log.New(io.Discard, "", 0)}, store
}

func TestProbeSnapshotFreshness(t *testing.T) {
	s, store := newProbeTestServer(t)
	ctx := context.Background()
	probe := snapshotFreshnessProbe{flow: "stripe_snapshot", read: store.GetStripeWaitlistSnapshotBytes}

	// Missing snapshot: every step fails.
	if readOK, parseOK, freshOK := s.probeSnapshotFreshness(probe); readOK || parseOK || freshOK {
		t.Fatalf("missing snapshot: got read=%v parse=%v fresh=%v, want all false", readOK, parseOK, freshOK)
	}

	// Fresh snapshot: all steps pass.
	writeSnapshot(t, ctx, store, time.Now().UTC().Add(-10*time.Minute))
	if readOK, parseOK, freshOK := s.probeSnapshotFreshness(probe); !readOK || !parseOK || !freshOK {
		t.Fatalf("fresh snapshot: got read=%v parse=%v fresh=%v, want all true", readOK, parseOK, freshOK)
	}

	// Stale snapshot: read+parse pass, fresh fails.
	writeSnapshot(t, ctx, store, time.Now().UTC().Add(-3*time.Hour))
	if readOK, parseOK, freshOK := s.probeSnapshotFreshness(probe); !readOK || !parseOK || freshOK {
		t.Fatalf("stale snapshot: got read=%v parse=%v fresh=%v, want read+parse true, fresh false", readOK, parseOK, freshOK)
	}

	// Unparseable fetchedAt: read passes, parse fails.
	if err := store.SaveStripeWaitlistSnapshot(ctx, []byte(`{"fetchedAt":"not-a-timestamp","purchasers":[]}`)); err != nil {
		t.Fatal(err)
	}
	if readOK, parseOK, freshOK := s.probeSnapshotFreshness(probe); !readOK || parseOK || freshOK {
		t.Fatalf("bad fetchedAt: got read=%v parse=%v fresh=%v, want read true, parse+fresh false", readOK, parseOK, freshOK)
	}
}

func writeSnapshot(t *testing.T, ctx context.Context, store *Store, at time.Time) {
	t.Helper()
	blob := []byte(fmt.Sprintf(`{"fetchedAt":%q,"purchasers":[]}`, at.Format(time.RFC3339)))
	if err := store.SaveStripeWaitlistSnapshot(ctx, blob); err != nil {
		t.Fatal(err)
	}
}

package app

import (
	"context"
	"io"
	"log"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newLifecycleAssignTestServer(t *testing.T, allowlist []string) *Server {
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
		cfg:   Config{MarketingAllowlist: allowlist},
		log:   log.New(io.Discard, "", 0),
	}
}

func TestAssignInitialLifecycleTier_underCapStampsFreeLifetime(t *testing.T) {
	s := newLifecycleAssignTestServer(t, nil)
	ctx := context.Background()
	if err := s.store.UpsertUserProfileSlackID(ctx, "alice@example.com", "U1"); err != nil {
		t.Fatal(err)
	}
	got, err := s.AssignInitialLifecycleTier(ctx, "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != LifecycleAssignmentFreeLifetime {
		t.Fatalf("got %q, want free_lifetime", got)
	}
	row, err := s.store.UserProfileRowByEmail(ctx, "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !row.FreeLifetime {
		t.Fatal("expected FreeLifetime=true")
	}
	if row.TrialExpiresAt != 0 {
		t.Fatalf("trial_expires_at should be zero, got %d", row.TrialExpiresAt)
	}
}

func TestAssignInitialLifecycleTier_atCapStampsTrialing(t *testing.T) {
	s := newLifecycleAssignTestServer(t, nil)
	ctx := context.Background()
	// Seed cap free_lifetime profiles so the next assignment lands in trialing.
	for i := 0; i < FreeLifetimeSeatCap; i++ {
		em := "u" + itoaTest(i) + "@x.com"
		if err := s.store.MarkProfileFreeLifetime(ctx, em); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "newcomer@x.com", "U101"); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UTC().Unix()
	got, err := s.AssignInitialLifecycleTier(ctx, "newcomer@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != LifecycleAssignmentTrialing {
		t.Fatalf("got %q, want trialing", got)
	}
	row, err := s.store.UserProfileRowByEmail(ctx, "newcomer@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.FreeLifetime {
		t.Fatal("newcomer should not be free_lifetime past the cap")
	}
	if row.TrialExpiresAt == 0 {
		t.Fatal("expected trial_expires_at set")
	}
	// Deadline is 10 days out, within a 5-second jitter window.
	want := before + int64(FreeTrialDuration/time.Second)
	if row.TrialExpiresAt < want-5 || row.TrialExpiresAt > want+5 {
		t.Fatalf("trial_expires_at = %d, want ~%d (±5s)", row.TrialExpiresAt, want)
	}
	if row.StripeSubscriptionStatus != "trialing" {
		t.Fatalf("subscription_status = %q, want trialing", row.StripeSubscriptionStatus)
	}
}

func TestAssignInitialLifecycleTier_allowlistAlwaysFreeLifetime(t *testing.T) {
	s := newLifecycleAssignTestServer(t, []string{"grant@bimross.com"})
	ctx := context.Background()
	// Already past cap.
	for i := 0; i < FreeLifetimeSeatCap; i++ {
		em := "u" + itoaTest(i) + "@x.com"
		if err := s.store.MarkProfileFreeLifetime(ctx, em); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "GRANT@bimross.com", "UGRANT"); err != nil {
		t.Fatal(err)
	}
	got, err := s.AssignInitialLifecycleTier(ctx, "grant@bimross.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != LifecycleAssignmentFreeLifetime {
		t.Fatalf("got %q, want free_lifetime (allowlisted)", got)
	}
}

func TestAssignInitialLifecycleTier_idempotentOnAlreadyStamped(t *testing.T) {
	s := newLifecycleAssignTestServer(t, nil)
	ctx := context.Background()

	// Case 1: free_lifetime already stamped — leave alone.
	if err := s.store.MarkProfileFreeLifetime(ctx, "stamped@x.com"); err != nil {
		t.Fatal(err)
	}
	got, err := s.AssignInitialLifecycleTier(ctx, "stamped@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != LifecycleAssignmentUnchanged {
		t.Fatalf("got %q, want unchanged for already-free_lifetime", got)
	}

	// Case 2: trial_expires_at already set — leave alone (don't refresh the deadline).
	original := time.Now().UTC().Add(3 * 24 * time.Hour).Unix()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "intrial@x.com", "", original); err != nil {
		t.Fatal(err)
	}
	got, err = s.AssignInitialLifecycleTier(ctx, "intrial@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if got != LifecycleAssignmentUnchanged {
		t.Fatalf("got %q, want unchanged for already-trialing", got)
	}
	row, err := s.store.UserProfileRowByEmail(ctx, "intrial@x.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.TrialExpiresAt != original {
		t.Fatalf("trial deadline was rewritten: got %d, want %d", row.TrialExpiresAt, original)
	}
}

// itoaTest avoids pulling strconv into a test-only helper namespace clash.
func itoaTest(i int) string {
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

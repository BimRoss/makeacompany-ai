package app

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestSweepLifecycleOnce_countsByStatus(t *testing.T) {
	s, _ := newReaperTestServer(t)
	ctx := context.Background()

	// Reset gauge to a known baseline so prior tests in the same process don't leak.
	lifecycleUsers.Reset()

	// Two free-lifetime profiles.
	if err := s.store.MarkProfileFreeLifetime(ctx, "lifer1@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := s.store.MarkProfileFreeLifetime(ctx, "lifer2@example.com"); err != nil {
		t.Fatal(err)
	}

	// One live trial, one expired trial.
	seedTrialing(t, s, "live@example.com", "ULIVE", time.Now().Add(72*time.Hour).Unix())
	seedTrialing(t, s, "expired@example.com", "UEXP", 1)

	// One active subscriber.
	if err := s.store.UpsertUserProfileStripeSubscription(
		ctx, "paid@example.com", "cus_1", "sub_1", "active", "base", "price_1", "prod_1", false, time.Now().Add(30*24*time.Hour).Unix(),
	); err != nil {
		t.Fatal(err)
	}

	s.sweepLifecycleOnce(ctx)

	cases := []struct {
		status string
		want   float64
	}{
		{"free_lifetime", 2},
		{"trialing", 1},
		{"active", 1},
		{"expired", 1},
	}
	for _, tc := range cases {
		got := testutil.ToFloat64(lifecycleUsers.WithLabelValues(tc.status))
		if got != tc.want {
			t.Errorf("lifecycleUsers{status=%q} = %v, want %v", tc.status, got, tc.want)
		}
	}
}

func TestSweepLifecycleOnce_excludesForeignProductOrphans(t *testing.T) {
	s, _ := newReaperTestServer(t)
	s.cfg.StripeProductBasePlan = "prod_base"
	ctx := context.Background()
	lifecycleUsers.Reset()

	// A real free-lifetime MaC member.
	if err := s.store.MarkProfileFreeLifetime(ctx, "member@example.com"); err != nil {
		t.Fatal(err)
	}
	// A foreign-product subscriber (e.g. cycler.io) with no Slack identity, minted by a subscription
	// webhook. Even though it's "active" on its own product, it is not a MaC member and must be excluded
	// from every cohort — not counted as active, and not counted as expired either.
	if err := s.store.UpsertUserProfileStripeSubscription(
		ctx, "cycler@example.com", "cus_c", "sub_c", "active", "subscriber", "price_c", "prod_foreign", false, time.Now().Add(30*24*time.Hour).Unix(),
	); err != nil {
		t.Fatal(err)
	}

	s.sweepLifecycleOnce(ctx)

	cases := []struct {
		status string
		want   float64
	}{
		{"free_lifetime", 1},
		{"trialing", 0},
		{"active", 0},
		{"expired", 0},
	}
	for _, tc := range cases {
		got := testutil.ToFloat64(lifecycleUsers.WithLabelValues(tc.status))
		if got != tc.want {
			t.Errorf("lifecycleUsers{status=%q} = %v, want %v", tc.status, got, tc.want)
		}
	}
}

func TestSweepLifecycleOnce_emptyStoreZeroesAllStatuses(t *testing.T) {
	s, _ := newReaperTestServer(t)
	lifecycleUsers.Reset()

	// Seed a stray "trialing" so we can prove the sweep resets back to 0.
	lifecycleUsers.WithLabelValues("trialing").Set(7)

	s.sweepLifecycleOnce(context.Background())

	for _, status := range []string{"free_lifetime", "trialing", "active", "expired"} {
		got := testutil.ToFloat64(lifecycleUsers.WithLabelValues(status))
		if got != 0 {
			t.Errorf("lifecycleUsers{status=%q} = %v, want 0", status, got)
		}
	}
}

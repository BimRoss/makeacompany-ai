package app

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// TestSweepTTFVOnce_quantilesAndBuckets exercises the full sweep: three
// profiles with known signup_at + first_seen_at land in known buckets,
// quantile reads match expected values, and skipped-row counters surface
// the data-gap reasons the /admin footnote will display.
func TestSweepTTFVOnce_quantilesAndBuckets(t *testing.T) {
	s, _ := newReaperTestServer(t)
	ctx := context.Background()

	ttfvQuantileSeconds.Reset()
	ttfvBucketUsers.Reset()
	ttfvSampleSize.Reset()
	ttfvSkippedProfiles.Reset()

	// Same-day converter (1 hour TTFV) — recent signup, in last7d.
	seedTTFV(t, s, "fast@example.com", "UFAST", time.Now().Add(-2*24*time.Hour), 1*time.Hour)
	// Week-ish converter (3 days TTFV) — recent signup, in last7d + last30d.
	seedTTFV(t, s, "mid@example.com", "UMID", time.Now().Add(-5*24*time.Hour), 3*24*time.Hour)
	// Two-week converter (10 days TTFV) — older signup, only in last30d + all.
	seedTTFV(t, s, "slow@example.com", "USLOW", time.Now().Add(-20*24*time.Hour), 10*24*time.Hour)

	// Skipped: profile with signup_at but no engagement row (no first_seen_at).
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "noseen@example.com", "", 0); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "noseen@example.com", "UNOSEEN"); err != nil {
		t.Fatal(err)
	}

	// Skipped: signup_at set but no slack_user_id linkage.
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "nolink@example.com", "", 0); err != nil {
		t.Fatal(err)
	}

	s.sweepTTFVOnce(ctx)

	// "all" cohort sees all three converters. p50 of [1h, 3d, 10d] sorted is 3d.
	gotAllP50 := testutil.ToFloat64(ttfvQuantileSeconds.WithLabelValues("all", "0.5"))
	want := (3 * 24 * time.Hour).Seconds()
	if gotAllP50 != want {
		t.Errorf("all p50: got %v want %v", gotAllP50, want)
	}
	// p90 of three samples is the max sample (nearest-rank rounds to index 3).
	gotAllP90 := testutil.ToFloat64(ttfvQuantileSeconds.WithLabelValues("all", "0.9"))
	wantP90 := (10 * 24 * time.Hour).Seconds()
	if gotAllP90 != wantP90 {
		t.Errorf("all p90: got %v want %v", gotAllP90, wantP90)
	}

	// Bucket totals across the three converters.
	cases := []struct {
		cohort string
		bucket string
		want   float64
	}{
		{"all", "same_day", 1},
		{"all", "week", 1},
		{"all", "two_weeks", 1},
		{"all", "month", 0},
		// last7d only contains the two recent signups.
		{"last7d", "same_day", 1},
		{"last7d", "week", 1},
		{"last7d", "two_weeks", 0},
		// last30d contains all three.
		{"last30d", "same_day", 1},
		{"last30d", "week", 1},
		{"last30d", "two_weeks", 1},
	}
	for _, c := range cases {
		got := testutil.ToFloat64(ttfvBucketUsers.WithLabelValues(c.cohort, c.bucket))
		if got != c.want {
			t.Errorf("cohort=%s bucket=%s: got %v want %v", c.cohort, c.bucket, got, c.want)
		}
	}

	// Sample sizes match cohort membership.
	if n := testutil.ToFloat64(ttfvSampleSize.WithLabelValues("all")); n != 3 {
		t.Errorf("all sample size: got %v want 3", n)
	}
	if n := testutil.ToFloat64(ttfvSampleSize.WithLabelValues("last7d")); n != 2 {
		t.Errorf("last7d sample size: got %v want 2", n)
	}

	// Skipped reasons feed the /admin "data gap" footnote.
	if n := testutil.ToFloat64(ttfvSkippedProfiles.WithLabelValues("no_first_seen_at")); n != 1 {
		t.Errorf("no_first_seen_at skipped: got %v want 1", n)
	}
	if n := testutil.ToFloat64(ttfvSkippedProfiles.WithLabelValues("no_slack_user_id")); n != 1 {
		t.Errorf("no_slack_user_id skipped: got %v want 1", n)
	}
}

// TestSweepTTFVOnce_clampsNegativeTTFV: a day-bucketed historical first_seen
// may land before backfilled signup_at. Clamping to zero keeps the row in the
// sample as a same-day onboard instead of silently dropping it.
func TestSweepTTFVOnce_clampsNegativeTTFV(t *testing.T) {
	s, _ := newReaperTestServer(t)

	ttfvBucketUsers.Reset()
	ttfvSampleSize.Reset()

	// first_seen is 1 day before signup_at (the historical-bucket case).
	seedTTFV(t, s, "neg@example.com", "UNEG", time.Now().Add(-5*24*time.Hour), -24*time.Hour)

	s.sweepTTFVOnce(context.Background())

	got := testutil.ToFloat64(ttfvBucketUsers.WithLabelValues("all", "same_day"))
	if got != 1 {
		t.Errorf("negative TTFV did not clamp to same-day bucket: got %v", got)
	}
}

// TestSweepTTFVOnce_selfBackfillsHistoricalProfiles: a profile that predates
// #581's HSetNX write path should get its signup_at derived in-place rather
// than waiting on a separate bash script. Trial-expires anchor wins for
// trialers; profile_updated_at carries the rest.
func TestSweepTTFVOnce_selfBackfillsHistoricalProfiles(t *testing.T) {
	s, _ := newReaperTestServer(t)
	ctx := context.Background()

	ttfvSkippedProfiles.Reset()
	ttfvSampleSize.Reset()

	// Historical trialer: signup_at missing, trial_expires_at set. Derives to expires - 10d.
	expiresAt := time.Now().Add(72 * time.Hour).Unix()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "histtrial@example.com", "", expiresAt); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "histtrial@example.com", "UHT"); err != nil {
		t.Fatal(err)
	}
	// Clear signup_at to simulate a pre-#581 row, since the upsert helpers now stamp it.
	if err := s.store.rdb.HDel(ctx, userProfileRedisKey("histtrial@example.com"), "signup_at").Err(); err != nil {
		t.Fatal(err)
	}
	// Stamp first_seen_at so we land in a bucket after backfill.
	firstSeen := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	if err := s.store.rdb.HSet(ctx, userEngagementKey("UHT"), "first_seen_at", firstSeen).Err(); err != nil {
		t.Fatal(err)
	}

	// Historical free-lifetime row: only profile_updated_at to anchor on.
	if err := s.store.MarkProfileFreeLifetime(ctx, "histfree@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "histfree@example.com", "UHF"); err != nil {
		t.Fatal(err)
	}
	if err := s.store.rdb.HDel(ctx, userProfileRedisKey("histfree@example.com"), "signup_at").Err(); err != nil {
		t.Fatal(err)
	}
	if err := s.store.rdb.HSet(ctx, userEngagementKey("UHF"), "first_seen_at", firstSeen).Err(); err != nil {
		t.Fatal(err)
	}

	s.sweepTTFVOnce(ctx)

	// Both profiles should now have a signup_at.
	for _, email := range []string{"histtrial@example.com", "histfree@example.com"} {
		got, err := s.store.rdb.HGet(ctx, userProfileRedisKey(email), "signup_at").Result()
		if err != nil {
			t.Fatalf("HGET signup_at %s: %v", email, err)
		}
		if got == "" {
			t.Errorf("%s: signup_at not derived", email)
		}
	}

	// And both should have landed in the sample.
	if n := testutil.ToFloat64(ttfvSampleSize.WithLabelValues("all")); n != 2 {
		t.Errorf("expected 2 backfilled profiles in sample, got %v", n)
	}
	if n := testutil.ToFloat64(ttfvSkippedProfiles.WithLabelValues("self_backfilled")); n != 2 {
		t.Errorf("self_backfilled counter: got %v want 2", n)
	}

	// Re-sweep is a no-op: HSetNX shouldn't move the timestamp, sample stays at 2.
	preTrial, _ := s.store.rdb.HGet(ctx, userProfileRedisKey("histtrial@example.com"), "signup_at").Result()
	s.sweepTTFVOnce(ctx)
	postTrial, _ := s.store.rdb.HGet(ctx, userProfileRedisKey("histtrial@example.com"), "signup_at").Result()
	if preTrial != postTrial {
		t.Errorf("second sweep moved signup_at: pre=%q post=%q", preTrial, postTrial)
	}
	// On the second sweep, nothing is newly backfilled (the gauge tracks per-sweep counts).
	if n := testutil.ToFloat64(ttfvSkippedProfiles.WithLabelValues("self_backfilled")); n != 0 {
		t.Errorf("second sweep self_backfilled counter: got %v want 0", n)
	}
}

// seedTTFV stamps a profile with signup_at, links it to a slack id, and
// writes a first_seen_at on the engagement hash at signup + ttfv. Letting
// callers set signupAt and ttfv directly keeps the cohort math obvious in
// the test cases above.
func seedTTFV(t *testing.T, s *Server, email, slackID string, signupAt time.Time, ttfv time.Duration) {
	t.Helper()
	ctx := context.Background()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, email, "", 0); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	// Overwrite the just-stamped signup_at with our chosen time so we control the cohort.
	if err := s.store.rdb.HSet(ctx, userProfileRedisKey(email), "signup_at", signupAt.UTC().Format(time.RFC3339)).Err(); err != nil {
		t.Fatalf("seed signup_at: %v", err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, email, slackID); err != nil {
		t.Fatalf("seed slack id: %v", err)
	}
	firstSeen := signupAt.Add(ttfv).UTC().Format(time.RFC3339)
	if err := s.store.rdb.HSet(ctx, userEngagementKey(slackID), "first_seen_at", firstSeen).Err(); err != nil {
		t.Fatalf("seed first_seen_at: %v", err)
	}
}

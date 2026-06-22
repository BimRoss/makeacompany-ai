package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

// fakeGitHubPRClient lets tests preload a per-repo (mergedAt, ok, err) outcome
// so the sweep can be driven without a network. unknown-repo lookups return
// (zero, false, nil) — the same shape the real client returns for a repo
// with no merged PRs yet.
type fakeGitHubPRClient struct {
	merges map[string]struct {
		at  time.Time
		ok  bool
		err error
	}
	calls map[string]int
}

func newFakeGitHubPRClient() *fakeGitHubPRClient {
	return &fakeGitHubPRClient{
		merges: map[string]struct {
			at  time.Time
			ok  bool
			err error
		}{},
		calls: map[string]int{},
	}
}

func (f *fakeGitHubPRClient) FirstMergedPRAt(_ context.Context, owner, repo string) (time.Time, bool, error) {
	k := owner + "/" + repo
	f.calls[k]++
	m, ok := f.merges[k]
	if !ok {
		return time.Time{}, false, nil
	}
	return m.at, m.ok, m.err
}

func (f *fakeGitHubPRClient) setMerged(owner, repo string, at time.Time) {
	f.merges[owner+"/"+repo] = struct {
		at  time.Time
		ok  bool
		err error
	}{at: at, ok: true}
}

func (f *fakeGitHubPRClient) setError(owner, repo string, err error) {
	f.merges[owner+"/"+repo] = struct {
		at  time.Time
		ok  bool
		err error
	}{err: err}
}

// seedTTFVPR seeds a user with a profile, slack id, signup_at, and a
// channel_site row pointing at the site_host. Mirrors seedTTFV's shape.
func seedTTFVPR(t *testing.T, s *Server, email, slackID, siteHost string, signupAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, email, "", 0); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	if err := s.store.rdb.HSet(ctx, userProfileRedisKey(email), "signup_at", signupAt.UTC().Format(time.RFC3339)).Err(); err != nil {
		t.Fatalf("seed signup_at: %v", err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, email, slackID); err != nil {
		t.Fatalf("seed slack id: %v", err)
	}
	channelID := "C0" + slackID
	if err := s.store.rdb.HSet(ctx, "channel_site:"+channelID,
		"user_id", slackID,
		"site_host", siteHost,
	).Err(); err != nil {
		t.Fatalf("seed channel_site: %v", err)
	}
}

func TestSweepTTFVPR_quantilesAndBuckets(t *testing.T) {
	s, _ := newReaperTestServer(t)
	gh := newFakeGitHubPRClient()
	s.githubPR = gh
	ctx := context.Background()

	ttfvPRQuantileSeconds.Reset()
	ttfvPRBucketUsers.Reset()
	ttfvPRSampleSize.Reset()
	ttfvPRSkippedProfiles.Reset()

	// Three converters with known TTFV-PR values, signups all within last 7d.
	// Truncate to second precision so the RFC3339 round-trip in signup_at and
	// merged_at doesn't introduce sub-second drift into the assertion.
	now := time.Now().Truncate(time.Second)
	fastSignup := now.Add(-2 * 24 * time.Hour)
	midSignup := now.Add(-5 * 24 * time.Hour)
	slowSignup := now.Add(-20 * 24 * time.Hour)

	seedTTFVPR(t, s, "fast@example.com", "UFAST", "fast.makeacompany.ai", fastSignup)
	seedTTFVPR(t, s, "mid@example.com", "UMID", "mid.makeacompany.ai", midSignup)
	seedTTFVPR(t, s, "slow@example.com", "USLOW", "slow.makeacompany.ai", slowSignup)

	gh.setMerged("BimRoss", "fast.makeacompany.ai", fastSignup.Add(1*time.Hour))
	gh.setMerged("BimRoss", "mid.makeacompany.ai", midSignup.Add(3*24*time.Hour))
	gh.setMerged("BimRoss", "slow.makeacompany.ai", slowSignup.Add(10*24*time.Hour))

	// Skip case: site_host set but GH has no merged PR yet.
	seedTTFVPR(t, s, "nopr@example.com", "UNOPR", "nopr.makeacompany.ai", now.Add(-1*24*time.Hour))

	// Skip case: user with profile + signup_at but no channel_site row.
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, "nositerow@example.com", "", 0); err != nil {
		t.Fatal(err)
	}
	if err := s.store.rdb.HSet(ctx, userProfileRedisKey("nositerow@example.com"), "signup_at", now.Add(-3*24*time.Hour).UTC().Format(time.RFC3339)).Err(); err != nil {
		t.Fatal(err)
	}
	if err := s.store.UpsertUserProfileSlackID(ctx, "nositerow@example.com", "UNOROW"); err != nil {
		t.Fatal(err)
	}

	s.sweepTTFVPROnce(ctx)

	gotAllP50 := testutil.ToFloat64(ttfvPRQuantileSeconds.WithLabelValues("all", "0.5"))
	want := (3 * 24 * time.Hour).Seconds()
	if gotAllP50 != want {
		t.Errorf("all p50: got %v want %v", gotAllP50, want)
	}

	gotLast7dSample := testutil.ToFloat64(ttfvPRSampleSize.WithLabelValues("last7d"))
	if gotLast7dSample != 2 {
		t.Errorf("last7d sample size: got %v want 2 (fast + mid)", gotLast7dSample)
	}

	gotNoPR := testutil.ToFloat64(ttfvPRSkippedProfiles.WithLabelValues("no_pr_merged_yet"))
	if gotNoPR != 1 {
		t.Errorf("no_pr_merged_yet skip count: got %v want 1", gotNoPR)
	}
	gotNoSite := testutil.ToFloat64(ttfvPRSkippedProfiles.WithLabelValues("no_site_host"))
	if gotNoSite != 1 {
		t.Errorf("no_site_host skip count: got %v want 1", gotNoSite)
	}

	// Second sweep: every found user is already cached in user_engagement,
	// so the GH client must not be called again for them. The no-PR user
	// is still polled (no cache to consult).
	beforeCalls := gh.calls["BimRoss/fast.makeacompany.ai"]
	s.sweepTTFVPROnce(ctx)
	afterCalls := gh.calls["BimRoss/fast.makeacompany.ai"]
	if afterCalls != beforeCalls {
		t.Errorf("activated user re-queried: before=%d after=%d", beforeCalls, afterCalls)
	}
}

func TestSweepTTFVPR_negativeTTFVClamped(t *testing.T) {
	s, _ := newReaperTestServer(t)
	gh := newFakeGitHubPRClient()
	s.githubPR = gh
	ctx := context.Background()

	ttfvPRQuantileSeconds.Reset()
	ttfvPRSampleSize.Reset()
	ttfvPRSkippedProfiles.Reset()

	// signup_at backfilled later than the historical PR — TTFV would be
	// negative. Sweeper clamps to 0 instead of dropping the row.
	signup := time.Now().Add(-3 * 24 * time.Hour)
	prAt := signup.Add(-24 * time.Hour)
	seedTTFVPR(t, s, "neg@example.com", "UNEG", "neg.makeacompany.ai", signup)
	gh.setMerged("BimRoss", "neg.makeacompany.ai", prAt)

	s.sweepTTFVPROnce(ctx)

	gotSample := testutil.ToFloat64(ttfvPRSampleSize.WithLabelValues("all"))
	if gotSample != 1 {
		t.Fatalf("sample size: got %v want 1", gotSample)
	}
	gotP50 := testutil.ToFloat64(ttfvPRQuantileSeconds.WithLabelValues("all", "0.5"))
	if gotP50 != 0 {
		t.Errorf("clamped p50: got %v want 0", gotP50)
	}
}

func TestSweepTTFVPR_githubErrorBumpsCounter(t *testing.T) {
	s, _ := newReaperTestServer(t)
	gh := newFakeGitHubPRClient()
	s.githubPR = gh
	ctx := context.Background()

	ttfvPRSkippedProfiles.Reset()

	seedTTFVPR(t, s, "boom@example.com", "UBOOM", "boom.makeacompany.ai", time.Now().Add(-2*24*time.Hour))
	gh.setError("BimRoss", "boom.makeacompany.ai", errors.New("502 bad gateway"))

	s.sweepTTFVPROnce(ctx)

	gotErrors := testutil.ToFloat64(ttfvPRSkippedProfiles.WithLabelValues("github_api_error"))
	if gotErrors != 1 {
		t.Errorf("github_api_error skip count: got %v want 1", gotErrors)
	}
}

func TestSweepTTFVPR_cachedReadSkipsGitHub(t *testing.T) {
	s, _ := newReaperTestServer(t)
	gh := newFakeGitHubPRClient()
	s.githubPR = gh
	ctx := context.Background()

	ttfvPRSampleSize.Reset()

	signup := time.Now().Add(-5 * 24 * time.Hour)
	prAt := signup.Add(2 * 24 * time.Hour)
	seedTTFVPR(t, s, "cached@example.com", "UCACHE", "cached.makeacompany.ai", signup)
	// Pre-stamp the cache so the sweeper should never call GH.
	if err := s.store.rdb.HSet(ctx, userEngagementKey("UCACHE"), firstPRMergedAtField, prAt.UTC().Format(time.RFC3339)).Err(); err != nil {
		t.Fatal(err)
	}

	s.sweepTTFVPROnce(ctx)

	if calls := gh.calls["BimRoss/cached.makeacompany.ai"]; calls != 0 {
		t.Errorf("cached user hit GH: got %d calls want 0", calls)
	}
	if got := testutil.ToFloat64(ttfvPRSampleSize.WithLabelValues("all")); got != 1 {
		t.Errorf("cached user not counted in sample: got %v want 1", got)
	}
}

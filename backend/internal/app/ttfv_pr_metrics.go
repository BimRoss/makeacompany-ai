package app

import (
	"context"
	"sort"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// TTFV-PR ("time to first value, PR variant") is signup_at -> first PR merged
// into main/master on the user's site repo. Lives in parallel with the
// message-based TTFV gauges (ttfv_metrics.go) so we can compare both readings
// during the cutover before retiring the weaker signal. Tracked under #621.
//
// The join path:
//
//   channel_site:<channelID>  -> {user_id, site_host, ...}        (Joanne + Ross hook)
//   user:<email>              -> {signup_at, slack_user_id, ...}  (#581)
//   user_engagement:<slackID> -> {first_pr_merged_at, ...}        (this file)
//
// site_host is BimRoss/<host>, e.g. bracesforfeet.makeacompany.ai. We poll
// the GitHub REST API once per user-without-a-stamp per sweep, then HSetNX
// the merge timestamp so a future sweep never re-queries that user.
var (
	ttfvPRQuantileSeconds = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_pr_quantile_seconds",
			Help: "Time-to-first-value (signup -> first merged PR) quantile in seconds, by signup cohort (#621).",
		},
		[]string{"cohort", "quantile"},
	)
	ttfvPRBucketUsers = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_pr_bucket_users",
			Help: "Count of users whose TTFV-PR falls in this bucket, by signup cohort.",
		},
		[]string{"cohort", "bucket"},
	)
	ttfvPRSampleSize = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_pr_sample_size",
			Help: "Count of profiles contributing to the TTFV-PR computation for this cohort.",
		},
		[]string{"cohort"},
	)
	ttfvPRSkippedProfiles = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_pr_skipped_profiles",
			Help: "Count of profiles excluded from TTFV-PR for this reason, surfaced as the /admin 'data gap' footnote.",
		},
		[]string{"reason"},
	)
)

func init() {
	prometheus.MustRegister(ttfvPRQuantileSeconds, ttfvPRBucketUsers, ttfvPRSampleSize, ttfvPRSkippedProfiles)
}

const (
	ttfvPRSweepInterval = 5 * time.Minute

	// Field on user_engagement:<slack_user_id>. HSetNX so the first merge
	// stamps forever; a later sweep can't roll it back.
	firstPRMergedAtField = "first_pr_merged_at"

	// GitHub owner is constant — every makeacompany user-site repo lives
	// under BimRoss. Personal repos under other owners would need a per-repo
	// owner field on channel_site; out of scope for v1.
	githubOwner = "BimRoss"
)

// StartTTFVPRSweeper kicks off the recurring sweep. Mirrors StartTTFVSweeper:
// runs an immediate first pass so /admin doesn't sit empty on a cold boot, then
// ticks every ttfvPRSweepInterval. A transient Redis or GitHub hiccup logs and
// waits for the next tick; we never blank the dashboard mid-flight.
func (s *Server) StartTTFVPRSweeper(ctx context.Context) {
	if s.githubPR == nil {
		// No token configured (local dev / pre-secret-rotation). The gauges
		// stay registered but empty, the panel hides via hideWhenEmpty.
		s.log.Printf("ttfv-pr sweeper: disabled (no GITHUB_TOKEN)")
		return
	}
	go func() {
		s.sweepTTFVPROnce(ctx)
		ticker := time.NewTicker(ttfvPRSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.sweepTTFVPROnce(ctx)
			}
		}
	}()
}

func (s *Server) sweepTTFVPROnce(ctx context.Context) {
	rows, err := s.store.ListUserProfiles(ctx)
	if err != nil {
		s.log.Printf("ttfv-pr sweeper: list profiles: %v", err)
		return
	}

	// Build the user_id -> site_host index from channel_site:* once per sweep.
	// SCAN-based so a large workspace doesn't block Redis like KEYS would.
	siteByUser, err := s.loadChannelSiteIndex(ctx)
	if err != nil {
		s.log.Printf("ttfv-pr sweeper: load channel_site index: %v", err)
		return
	}

	now := time.Now().UTC()
	bySample := map[string][]time.Duration{
		ttfvCohortAll:     nil,
		ttfvCohortLast7d:  nil,
		ttfvCohortLast30d: nil,
	}
	var (
		skippedNoSignup   int
		skippedNoSlack    int
		skippedNoSite     int
		skippedNoPR       int
		skippedUnparseable int
		skippedAPIError   int
	)

	for _, row := range rows {
		if row.SignupAt == "" {
			skippedNoSignup++
			continue
		}
		if row.SlackUserID == "" {
			skippedNoSlack++
			continue
		}
		siteHost := siteByUser[row.SlackUserID]
		if siteHost == "" {
			// User has no site repo yet — pre-activation, not a data gap.
			skippedNoSite++
			continue
		}

		mergedAt, ok, err := s.resolveFirstPRMergedAt(ctx, row.SlackUserID, siteHost)
		if err != nil {
			skippedAPIError++
			s.log.Printf("ttfv-pr sweeper: github %s for %s: %v", siteHost, row.SlackUserID, err)
			continue
		}
		if !ok {
			skippedNoPR++
			continue
		}

		signup, err := time.Parse(time.RFC3339, row.SignupAt)
		if err != nil {
			skippedUnparseable++
			continue
		}
		ttfv := mergedAt.Sub(signup)
		if ttfv < 0 {
			// Same defense as the message-based sweep: a backfilled signup_at
			// can land after a historical PR merge. Clamp to zero.
			ttfv = 0
		}

		bySample[ttfvCohortAll] = append(bySample[ttfvCohortAll], ttfv)
		signupAge := now.Sub(signup)
		if signupAge <= 7*24*time.Hour {
			bySample[ttfvCohortLast7d] = append(bySample[ttfvCohortLast7d], ttfv)
		}
		if signupAge <= 30*24*time.Hour {
			bySample[ttfvCohortLast30d] = append(bySample[ttfvCohortLast30d], ttfv)
		}
	}

	for cohort, sample := range bySample {
		publishTTFVPRCohort(cohort, sample)
	}
	ttfvPRSkippedProfiles.WithLabelValues("no_signup_at").Set(float64(skippedNoSignup))
	ttfvPRSkippedProfiles.WithLabelValues("no_slack_user_id").Set(float64(skippedNoSlack))
	ttfvPRSkippedProfiles.WithLabelValues("no_site_host").Set(float64(skippedNoSite))
	ttfvPRSkippedProfiles.WithLabelValues("no_pr_merged_yet").Set(float64(skippedNoPR))
	ttfvPRSkippedProfiles.WithLabelValues("unparseable_timestamp").Set(float64(skippedUnparseable))
	ttfvPRSkippedProfiles.WithLabelValues("github_api_error").Set(float64(skippedAPIError))
}

// resolveFirstPRMergedAt returns the cached merge timestamp from
// user_engagement:<slack_id> when present (no GitHub call), otherwise hits
// GitHub and HSetNX's the result so the next sweep skips the API. Returns
// (zero, false, nil) when the repo exists but has no merged PRs yet.
func (s *Server) resolveFirstPRMergedAt(ctx context.Context, slackUserID, siteHost string) (time.Time, bool, error) {
	engagementKey := userEngagementKey(slackUserID)
	cached, err := s.store.rdb.HGet(ctx, engagementKey, firstPRMergedAtField).Result()
	if err == nil && cached != "" {
		t, perr := time.Parse(time.RFC3339, cached)
		if perr == nil {
			return t, true, nil
		}
		// Cached value is malformed somehow — fall through to a fresh GH lookup.
	}

	mergedAt, ok, err := s.githubPR.FirstMergedPRAt(ctx, githubOwner, siteHost)
	if err != nil {
		return time.Time{}, false, err
	}
	if !ok {
		return time.Time{}, false, nil
	}
	// HSetNX so a concurrent writer (or a future sweep that beats us to it)
	// never overwrites the canonical first-merge timestamp.
	if err := s.store.rdb.HSetNX(ctx, engagementKey, firstPRMergedAtField, mergedAt.UTC().Format(time.RFC3339)).Err(); err != nil {
		s.log.Printf("ttfv-pr sweeper: HSetNX %s: %v", engagementKey, err)
	}
	return mergedAt, true, nil
}

// loadChannelSiteIndex walks channel_site:* via SCAN and returns a
// slack_user_id -> site_host map. Skips rows missing user_id or with an
// empty site_host (user hasn't created a site repo yet). When a user has
// multiple channels with site_host set, the last one wins — there's no
// principled "first" given the Ross autoadd hook overwrites created_at
// per repo create. In practice users have one site, so this is moot.
func (s *Server) loadChannelSiteIndex(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	var cursor uint64
	for {
		keys, next, err := s.store.rdb.Scan(ctx, cursor, "channel_site:*", 256).Result()
		if err != nil {
			return nil, err
		}
		for _, k := range keys {
			vals, err := s.store.rdb.HMGet(ctx, k, "user_id", "site_host").Result()
			if err != nil {
				continue
			}
			userID, _ := vals[0].(string)
			siteHost, _ := vals[1].(string)
			if userID == "" || siteHost == "" {
				continue
			}
			out[userID] = siteHost
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return out, nil
}

func publishTTFVPRCohort(cohort string, sample []time.Duration) {
	ttfvPRSampleSize.WithLabelValues(cohort).Set(float64(len(sample)))

	for _, b := range ttfvBuckets {
		ttfvPRBucketUsers.WithLabelValues(cohort, b.name).Set(0)
	}
	for _, q := range ttfvQuantiles {
		ttfvPRQuantileSeconds.WithLabelValues(cohort, formatQuantileLabel(q)).Set(0)
	}
	if len(sample) == 0 {
		return
	}

	sort.Slice(sample, func(i, j int) bool { return sample[i] < sample[j] })
	for _, q := range ttfvQuantiles {
		v := nearestRankQuantile(sample, q)
		ttfvPRQuantileSeconds.WithLabelValues(cohort, formatQuantileLabel(q)).Set(v.Seconds())
	}
	for _, d := range sample {
		bucket := bucketForTTFV(d)
		ttfvPRBucketUsers.WithLabelValues(cohort, bucket).Inc()
	}
}

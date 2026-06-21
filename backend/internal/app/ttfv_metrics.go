package app

import (
	"context"
	"sort"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
)

// TTFV ("time to first value") is signup_at -> first ingested message, the
// onboarding-funnel metric tracked under issue #579.
//
// We model it as Gauges rather than a Prometheus histogram because the
// sweeper recomputes the distribution from scratch every tick: a real
// histogram's Observe() would double-count each profile every 5 minutes
// instead of representing the *current* population. The lifecycleUsers
// gauge follows the same pattern.
//
// Three cohorts (all/last7d/last30d) crossed with a small set of quantiles
// and a fixed bucket layout. PromQL stays trivial -- no histogram_quantile()
// dance, just `makeacompany_ttfv_quantile_seconds{cohort="last30d",quantile="0.5"}`.
var (
	ttfvQuantileSeconds = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_quantile_seconds",
			Help: "Time-to-first-value quantile in seconds, by signup cohort and quantile (#579).",
		},
		[]string{"cohort", "quantile"},
	)
	ttfvBucketUsers = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_bucket_users",
			Help: "Count of users whose TTFV falls in this bucket, by signup cohort.",
		},
		[]string{"cohort", "bucket"},
	)
	ttfvSampleSize = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_sample_size",
			Help: "Count of profiles contributing to the TTFV computation for this cohort.",
		},
		[]string{"cohort"},
	)
	ttfvSkippedProfiles = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_ttfv_skipped_profiles",
			Help: "Count of profiles excluded from TTFV for this reason, surfaced as the /admin 'data gap' footnote.",
		},
		[]string{"reason"},
	)
)

func init() {
	prometheus.MustRegister(ttfvQuantileSeconds, ttfvBucketUsers, ttfvSampleSize, ttfvSkippedProfiles)
}

const (
	ttfvSweepInterval = 5 * time.Minute

	ttfvCohortAll     = "all"
	ttfvCohortLast7d  = "last7d"
	ttfvCohortLast30d = "last30d"
)

var ttfvQuantiles = []float64{0.5, 0.9}

// ttfvBuckets is the same shape we used by hand on Joanne's dump: same-day,
// first week, second week, first month, first quarter, longer. Each bucket
// is an upper bound in seconds; values strictly greater than the previous
// bound and at-or-below this one land here. "longer" catches the tail.
var ttfvBuckets = []struct {
	name  string
	upper time.Duration
}{
	{"same_day", 24 * time.Hour},
	{"week", 7 * 24 * time.Hour},
	{"two_weeks", 14 * 24 * time.Hour},
	{"month", 30 * 24 * time.Hour},
	{"quarter", 90 * 24 * time.Hour},
	{"longer", 1<<63 - 1},
}

// StartTTFVSweeper scans every profile on an interval, joins to the user_engagement
// hash for first_seen_at, and republishes the TTFV gauges. Mirrors the lifecycle
// sweeper's tick + recovery pattern: a transient Redis hiccup logs and waits for
// the next tick; we never blank the dashboard mid-flight.
func (s *Server) StartTTFVSweeper(ctx context.Context) {
	go func() {
		s.sweepTTFVOnce(ctx)
		ticker := time.NewTicker(ttfvSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.sweepTTFVOnce(ctx)
			}
		}
	}()
}

func (s *Server) sweepTTFVOnce(ctx context.Context) {
	rows, err := s.store.ListUserProfiles(ctx)
	if err != nil {
		s.log.Printf("ttfv sweeper: list profiles: %v", err)
		return
	}

	// Round-trip every first_seen_at lookup in a single pipeline so a workspace
	// with thousands of profiles doesn't N+1 the sweep into oblivion.
	keys := make([]string, 0, len(rows))
	indexByKey := make(map[string]int, len(rows))
	skippedNoSignup := 0
	skippedNoSlack := 0
	for i, row := range rows {
		if row.SignupAt == "" {
			skippedNoSignup++
			continue
		}
		if row.SlackUserID == "" {
			skippedNoSlack++
			continue
		}
		k := userEngagementKey(row.SlackUserID)
		keys = append(keys, k)
		indexByKey[k] = i
	}

	firstSeens, err := s.store.batchHGet(ctx, keys, "first_seen_at")
	if err != nil {
		s.log.Printf("ttfv sweeper: pipelined HGET: %v", err)
		return
	}

	now := time.Now().UTC()
	bySample := map[string][]time.Duration{
		ttfvCohortAll:     nil,
		ttfvCohortLast7d:  nil,
		ttfvCohortLast30d: nil,
	}
	skippedNoFirstSeen := 0
	skippedUnparseable := 0
	for k, raw := range firstSeens {
		if raw == "" {
			skippedNoFirstSeen++
			continue
		}
		i := indexByKey[k]
		signup, err := time.Parse(time.RFC3339, rows[i].SignupAt)
		if err != nil {
			skippedUnparseable++
			continue
		}
		firstSeen, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			skippedUnparseable++
			continue
		}
		ttfv := firstSeen.Sub(signup)
		if ttfv < 0 {
			// Day-bucketed historical first_seen_at can land before a signup_at that
			// the backfill wrote at trial_expires - 10d. Clamp to zero rather than
			// drop the row -- a same-day onboard is the most useful read of either.
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
		publishTTFVCohort(cohort, sample)
	}
	ttfvSkippedProfiles.WithLabelValues("no_signup_at").Set(float64(skippedNoSignup))
	ttfvSkippedProfiles.WithLabelValues("no_slack_user_id").Set(float64(skippedNoSlack))
	ttfvSkippedProfiles.WithLabelValues("no_first_seen_at").Set(float64(skippedNoFirstSeen))
	ttfvSkippedProfiles.WithLabelValues("unparseable_timestamp").Set(float64(skippedUnparseable))
}

func publishTTFVCohort(cohort string, sample []time.Duration) {
	ttfvSampleSize.WithLabelValues(cohort).Set(float64(len(sample)))

	// Zero out every bucket first so a shrinking cohort doesn't leave stale counts behind.
	for _, b := range ttfvBuckets {
		ttfvBucketUsers.WithLabelValues(cohort, b.name).Set(0)
	}
	for _, q := range ttfvQuantiles {
		ttfvQuantileSeconds.WithLabelValues(cohort, formatQuantileLabel(q)).Set(0)
	}
	if len(sample) == 0 {
		return
	}

	sort.Slice(sample, func(i, j int) bool { return sample[i] < sample[j] })
	for _, q := range ttfvQuantiles {
		v := nearestRankQuantile(sample, q)
		ttfvQuantileSeconds.WithLabelValues(cohort, formatQuantileLabel(q)).Set(v.Seconds())
	}
	for _, d := range sample {
		bucket := bucketForTTFV(d)
		ttfvBucketUsers.WithLabelValues(cohort, bucket).Inc()
	}
}

func bucketForTTFV(d time.Duration) string {
	for _, b := range ttfvBuckets {
		if d <= b.upper {
			return b.name
		}
	}
	return ttfvBuckets[len(ttfvBuckets)-1].name
}

// nearestRankQuantile returns the value at the rank-1 index, classic 1-based
// nearest-rank quantile. sample must be sorted ascending.
func nearestRankQuantile(sample []time.Duration, q float64) time.Duration {
	if len(sample) == 0 {
		return 0
	}
	if q <= 0 {
		return sample[0]
	}
	if q >= 1 {
		return sample[len(sample)-1]
	}
	rank := int(q*float64(len(sample)) + 0.5)
	if rank < 1 {
		rank = 1
	}
	if rank > len(sample) {
		rank = len(sample)
	}
	return sample[rank-1]
}

func formatQuantileLabel(q float64) string {
	// Two decimals is enough for p50 / p90 / p99 and reads cleanly in PromQL.
	switch q {
	case 0.5:
		return "0.5"
	case 0.9:
		return "0.9"
	case 0.99:
		return "0.99"
	default:
		return prettyFloat(q)
	}
}

func prettyFloat(q float64) string {
	// Avoid pulling fmt for the common quantile labels above; fall back here only
	// if someone adds a non-canonical quantile.
	return time.Duration(q * float64(time.Second)).String()
}

// batchHGet pipelines a single-field HGET across many hashes and returns
// key -> value (empty string when the field is absent or the key is missing).
// Lives on Store so callers in this package can reach it without exposing rdb.
func (s *Store) batchHGet(ctx context.Context, keys []string, field string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	pipe := s.rdb.Pipeline()
	cmds := make([]*redis.StringCmd, len(keys))
	for i, k := range keys {
		cmds[i] = pipe.HGet(ctx, k, field)
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		// redis.Nil is expected when at least one field is missing -- per-cmd errors
		// are inspected below. Any other error fails the batch.
		nonNilErr := false
		for _, c := range cmds {
			if e := c.Err(); e != nil && e != redis.Nil {
				nonNilErr = true
				break
			}
		}
		if nonNilErr {
			return out, err
		}
	}
	for i, c := range cmds {
		v, err := c.Result()
		if err != nil {
			// redis.Nil means the field was missing -- treat as empty string.
			out[keys[i]] = ""
			continue
		}
		out[keys[i]] = v
	}
	return out, nil
}

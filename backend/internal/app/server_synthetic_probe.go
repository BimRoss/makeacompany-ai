package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	syntheticOK = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_synthetic_ok",
			Help: "Synthetic golden-path probe result (1=ok, 0=fail) by flow and step; step=overall is the rollup.",
		},
		[]string{"flow", "step"},
	)
	syntheticDurationSeconds = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "makeacompany_synthetic_duration_seconds",
			Help: "Wall-clock duration of the synthetic golden-path probe, by flow.",
		},
		[]string{"flow"},
	)
)

func init() {
	prometheus.MustRegister(syntheticOK, syntheticDurationSeconds)
}

const (
	syntheticProbeInterval = 5 * time.Minute
	// Snapshot crons run hourly; allow the cadence plus a 30m grace before a
	// stale snapshot fails the probe. Matches the CronJobOverdue alert's 90m.
	syntheticSnapshotMaxAge = 90 * time.Minute
	syntheticProbeTimeout   = 30 * time.Second
)

// snapshotFreshnessProbe is one golden-path flow the probe checks: read the
// artifact back from Redis, confirm it parses, and confirm its embedded
// fetchedAt is fresh.
type snapshotFreshnessProbe struct {
	flow string
	read func(ctx context.Context) ([]byte, error)
}

// StartSyntheticProbe runs the read-only golden-path freshness probe on an
// interval. It reads each snapshot artifact back from Redis, confirms it parses,
// and checks the embedded fetchedAt is fresh — emitting makeacompany_synthetic_ok
// {flow,step}. It never writes and never calls upstream APIs, so it adds no load
// to Slack/Stripe or the snapshot cadence.
func (s *Server) StartSyntheticProbe() {
	probes := []snapshotFreshnessProbe{
		{flow: "slack_snapshot", read: s.store.GetSlackUsersSnapshotBytes},
		{flow: "stripe_snapshot", read: s.store.GetStripeWaitlistSnapshotBytes},
	}
	go func() {
		s.runSyntheticProbe(probes)
		t := time.NewTicker(syntheticProbeInterval)
		defer t.Stop()
		for range t.C {
			s.runSyntheticProbe(probes)
		}
	}()
}

func (s *Server) runSyntheticProbe(probes []snapshotFreshnessProbe) {
	for _, p := range probes {
		start := time.Now()
		readOK, parseOK, freshOK := s.probeSnapshotFreshness(p)
		syntheticOK.WithLabelValues(p.flow, "read").Set(boolToFloat(readOK))
		syntheticOK.WithLabelValues(p.flow, "parse").Set(boolToFloat(parseOK))
		syntheticOK.WithLabelValues(p.flow, "fresh").Set(boolToFloat(freshOK))
		syntheticOK.WithLabelValues(p.flow, "overall").Set(boolToFloat(readOK && parseOK && freshOK))
		syntheticDurationSeconds.WithLabelValues(p.flow).Set(time.Since(start).Seconds())
	}
}

func (s *Server) probeSnapshotFreshness(p snapshotFreshnessProbe) (readOK, parseOK, freshOK bool) {
	ctx, cancel := context.WithTimeout(context.Background(), syntheticProbeTimeout)
	defer cancel()

	raw, err := p.read(ctx)
	if err != nil || len(raw) == 0 {
		if err != nil {
			s.log.Printf("synthetic probe %s: read failed: %v", p.flow, err)
		}
		return false, false, false
	}

	var env struct {
		FetchedAt string `json:"fetchedAt"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		s.log.Printf("synthetic probe %s: parse failed: %v", p.flow, err)
		return true, false, false
	}

	ts, err := time.Parse(time.RFC3339, env.FetchedAt)
	if err != nil {
		s.log.Printf("synthetic probe %s: unparseable fetchedAt %q: %v", p.flow, env.FetchedAt, err)
		return true, false, false
	}

	age := time.Since(ts)
	if age > syntheticSnapshotMaxAge {
		s.log.Printf("synthetic probe %s: stale snapshot, age=%s exceeds %s", p.flow, age.Round(time.Second), syntheticSnapshotMaxAge)
		return true, true, false
	}
	return true, true, true
}

func boolToFloat(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

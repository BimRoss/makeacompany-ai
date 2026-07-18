package app

import (
	"context"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var lifecycleUsers = prometheus.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "makeacompany_lifecycle_users",
		Help: "Current count of user profiles by effective lifecycle status (free_lifetime, trialing, active, expired).",
	},
	[]string{"status"},
)

func init() {
	prometheus.MustRegister(lifecycleUsers)
}

const lifecycleSweepInterval = 5 * time.Minute

// StartLifecycleSweeper scans all user profiles on an interval, collapses each
// to its EffectiveStatus, and republishes the lifecycleUsers gauge. The gauge
// is the source of truth for the trial-cohort-over-time panel on /admin (#470).
//
// Runs in a goroutine and never exits until ctx is canceled. Errors are logged
// and the next tick is allowed to retry — a transient Redis hiccup should not
// blank the dashboard.
func (s *Server) StartLifecycleSweeper(ctx context.Context) {
	go func() {
		s.sweepLifecycleOnce(ctx)
		ticker := time.NewTicker(lifecycleSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.sweepLifecycleOnce(ctx)
			}
		}
	}()
}

func (s *Server) sweepLifecycleOnce(ctx context.Context) {
	rows, err := s.store.ListUserProfiles(ctx)
	if err != nil {
		s.log.Printf("lifecycle sweeper: %v", err)
		return
	}
	// The Slack workspace-users snapshot that previously let us drop
	// deactivated members (deleted=true) and bots/agents (is_bot=true) from the
	// cohort counts was retired, so those rows are no longer excluded — the
	// cohort graph now counts every profile by its EffectiveStatus.
	counts := map[LifecycleStatus]int{
		LifecycleFreeLifetime: 0,
		LifecycleTrialing:     0,
		LifecycleActive:       0,
		LifecycleExpired:      0,
	}
	now := time.Now().UTC()
	for _, row := range rows {
		st := EffectiveStatus(row, now, s.cfg.StripeProductBasePlan)
		if st == LifecycleExcluded {
			// Not a MaC member (e.g. a foreign-product Stripe orphan). Don't count it in any cohort.
			continue
		}
		counts[st]++
	}
	for status, n := range counts {
		lifecycleUsers.WithLabelValues(string(status)).Set(float64(n))
	}
}

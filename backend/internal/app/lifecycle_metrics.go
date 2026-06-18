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
	counts := map[LifecycleStatus]int{
		LifecycleFreeLifetime: 0,
		LifecycleTrialing:     0,
		LifecycleActive:       0,
		LifecycleExpired:      0,
	}
	now := time.Now().UTC()
	for _, row := range rows {
		counts[EffectiveStatus(row, now, s.cfg.StripeProductBasePlan)]++
	}
	for status, n := range counts {
		lifecycleUsers.WithLabelValues(string(status)).Set(float64(n))
	}
}

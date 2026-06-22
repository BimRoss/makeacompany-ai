package app

import (
	"context"
	"time"
)

// day7CheckinSweepInterval is the in-process tick cadence for the day-7 checkin reaper.
// Hourly is plenty: the scan window is 7 days wide, so the reaper can miss up to 23 ticks
// before any user actually ages out. Hourly costs ~24 Redis scans/day, which is noise
// next to the existing per-5-minute lifecycle sweeper.
const day7CheckinSweepInterval = 1 * time.Hour

// StartDay7CheckinSweeper runs the day-7 checkin reaper on day7CheckinSweepInterval until
// ctx is canceled. Errors are logged inside runDay7CheckinReaperOnce; the goroutine never
// exits on its own. Mirrors StartLifecycleSweeper / StartTTFVSweeper. #616.
func (s *Server) StartDay7CheckinSweeper(ctx context.Context) {
	go func() {
		s.runDay7CheckinReaperOnce(ctx, time.Now().UTC())
		ticker := time.NewTicker(day7CheckinSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runDay7CheckinReaperOnce(ctx, time.Now().UTC())
			}
		}
	}()
}

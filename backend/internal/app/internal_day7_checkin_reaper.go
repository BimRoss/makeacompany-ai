package app

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// handleInternalDay7CheckinReaper scans user profiles whose SignupAt is in the day-7
// enqueue window and pushes one Joanne-side day-7 checkin DM job per user onto
// JoanneDay7CheckinQueueKey. Idempotent via day7_checkin_enqueued_at on the profile hash.
//
// Bearer-gated like the other /v1/internal/* endpoints. Drained in parallel by the
// in-process StartDay7CheckinSweeper ticker — both call the same scan, so a manual
// POST after a code deploy can flush a backlog without waiting for the next tick.
//
// POST /v1/internal/day7-checkin-reaper
//
// Response: { "ok": true, "scanned": N, "enqueued": M }
func (s *Server) handleInternalDay7CheckinReaper(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	outcome := "error"
	start := time.Now()
	defer func() {
		cronjobDurationSeconds.WithLabelValues("day7-checkin-reaper", outcome).Observe(time.Since(start).Seconds())
	}()
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	scanned, enqueued := s.runDay7CheckinReaperOnce(r.Context(), time.Now().UTC())
	outcome = "success"
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"scanned":  scanned,
		"enqueued": enqueued,
	})
}

// runDay7CheckinReaperOnce is the body shared between the HTTP handler and the
// in-process daily ticker. Logs and continues on per-row enqueue errors so one
// bad profile doesn't tank the whole pass. Returns (scanned, enqueued).
func (s *Server) runDay7CheckinReaperOnce(ctx context.Context, now time.Time) (int, int) {
	candidates, err := s.store.ScanDay7CheckinDue(ctx, now)
	if err != nil {
		s.log.Printf("day7-checkin reaper scan: %v", err)
		return 0, 0
	}
	enqueued := 0
	for _, row := range candidates {
		slackID := strings.TrimSpace(row.SlackUserID)
		if slackID == "" {
			continue
		}
		job := Day7CheckinJob{
			SlackUserID: slackID,
			Email:       row.Email,
		}
		if err := s.store.EnqueueDay7CheckinJob(ctx, row.Email, job); err != nil {
			s.log.Printf("day7-checkin reaper enqueue %s: %v", row.Email, err)
			continue
		}
		enqueued++
	}
	day7CheckinReaperScannedTotal.Add(float64(len(candidates)))
	day7CheckinReaperEnqueuedTotal.Add(float64(enqueued))
	return len(candidates), enqueued
}

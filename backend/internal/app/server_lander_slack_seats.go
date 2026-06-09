package app

import (
	"net/http"
)

// LanderSeatCap is the seat cliff exposed in the public "N of CAP free seats claimed" pill.
// Aliased to FreeLifetimeSeatCap so the lander, the trial-start trigger, and the free-tier
// backfill share one source of truth (#324).
const LanderSeatCap = FreeLifetimeSeatCap

// handleLanderSlackSeats returns the live count of profiles with free_lifetime=true plus the
// seat cap, so the public pricing pill on the lander shows the *exact* number that decides
// whether the next signup gets free-for-life or a 7-day trial (#325 trigger). Previously this
// counted Slack workspace members from the snapshot, which (a) included bots and (b) drifted
// from the cutoff source.
func (s *Server) handleLanderSlackSeats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	count, err := s.store.CountFreeLifetimeProfiles(r.Context())
	if err != nil {
		s.log.Printf("lander free-lifetime count: %v", err)
		// On any backend hiccup, return cap-only with claimed=null. Frontend falls
		// back to its hard-coded constant so the pill never breaks the lander.
		writeJSON(w, http.StatusOK, map[string]any{
			"claimed": nil,
			"cap":     LanderSeatCap,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"claimed": count,
		"cap":     LanderSeatCap,
	})
}

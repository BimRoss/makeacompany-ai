package app

import (
	"errors"
	"net/http"
)

// LanderSeatCap is the seat cliff exposed in the public "N of CAP free seats claimed" pill.
// Matches WaitlistCap today; kept separate so the pricing pill and Stripe waitlist can diverge.
const LanderSeatCap = 100

// handleLanderSlackSeats returns the live count of Slack workspace members (non-deleted,
// bots included) plus the seat cap, so the public pricing pill on the lander can render
// the real number instead of a hard-coded constant. Same Redis snapshot the /admin Slack
// Users panel reads, so the two numbers stay in lockstep.
func (s *Server) handleLanderSlackSeats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claimed, ok := s.countLanderSlackSeats(r)
	if !ok {
		// On any backend hiccup, return cap-only with claimed=null. Frontend falls
		// back to its hard-coded constant so the pill never breaks the lander.
		writeJSON(w, http.StatusOK, map[string]any{
			"claimed": nil,
			"cap":     LanderSeatCap,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"claimed": claimed,
		"cap":     LanderSeatCap,
	})
}

func (s *Server) countLanderSlackSeats(r *http.Request) (int, bool) {
	ctx := r.Context()
	raw, err := s.store.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			warm := s.tryWarmSlackUsersSnapshotWhenMissing(ctx)
			if warm == nil {
				return 0, false
			}
			users, okCast := warm["users"].([]SlackWorkspaceUser)
			if !okCast {
				return 0, false
			}
			visible, _ := filterSlackUsersForDisplay(users, false)
			return len(visible), true
		}
		s.log.Printf("lander slack seats snapshot get: %v", err)
		return 0, false
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		s.log.Printf("lander slack seats snapshot parse: %v", err)
		return 0, false
	}
	visible, _ := filterSlackUsersForDisplay(env.Users, false)
	return len(visible), true
}

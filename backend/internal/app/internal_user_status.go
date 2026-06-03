package app

import (
	"net/http"
	"time"
)

// handleInternalUserStatus returns the lifecycle status (#241 EffectiveStatus) for a Slack user.
// Ross and Joanne dispatchers call this before spawning a Claude session and exit silent on `expired`
// (umbrella #240, child #243). Unknown users resolve to `free_lifetime` — the conservative default so we
// never silence someone we don't recognize.
//
// GET /v1/internal/user-status?slack_user_id=U...
//
// Response: { "status": "free_lifetime" | "trialing" | "active" | "expired", "slackUserId": "U..." }
func (s *Server) handleInternalUserStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID := r.URL.Query().Get("slack_user_id")
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	email, _, err := s.store.UserProfileTierBySlackUser(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("internal user-status slack lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to resolve user"})
		return
	}
	if email == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      string(EffectiveStatus(UserProfileRow{}, time.Now().UTC())),
			"slackUserId": slackUserID,
		})
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), email)
	if err != nil {
		s.log.Printf("internal user-status profile: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      string(EffectiveStatus(row, time.Now().UTC())),
		"slackUserId": slackUserID,
	})
}

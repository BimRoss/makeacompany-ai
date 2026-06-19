package app

import (
	"encoding/json"
	"net/http"
	"time"
)

type adminFreeLifetimeRequest struct {
	Email        string `json:"email"`
	FreeLifetime bool   `json:"freeLifetime"`
}

// handleAdminUserFreeLifetime lets an authenticated admin mark a user free-for-life (or revert it)
// from the /admin Slack-users table. Keyed by email — the canonical makeacompany:user_profile hash key.
// Returns the recomputed EffectiveStatus so the table reflects the change end-to-end. Admin-session
// gated (same as the agent kill switch); writes an audit line with the actor.
func (s *Server) handleAdminUserFreeLifetime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tok := tokenFromAuthHeader(r)
	session, err := s.validateAdminSession(r.Context(), tok)
	if err != nil {
		if !s.adminAuthEnabled() {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req adminFreeLifetimeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	email := normalizeProfileEmail(req.Email)
	if email == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "missing email"})
		return
	}
	if err := s.store.SetProfileFreeLifetime(r.Context(), email, req.FreeLifetime); err != nil {
		s.log.Printf("admin set free_lifetime email=%s by=%s: %v", email, session.Email, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	// Audit line — same stdout pipeline as the other admin mutations (see handleAdminAgentToggle).
	s.log.Printf("audit: admin set free_lifetime email=%s free_lifetime=%t actor=%s",
		email, req.FreeLifetime, session.Email)

	// Recompute the effective status from the freshly-written profile so the caller can update the row
	// without a full refetch. Note: a Stripe-active subscription still trumps free_lifetime in
	// EffectiveStatus, so an active user stays "active" — the flag is set, but the pill won't change
	// until/unless their subscription ends.
	status := ""
	if row, rErr := s.store.UserProfileRowByEmail(r.Context(), email); rErr == nil {
		status = string(EffectiveStatus(row, time.Now().UTC(), s.cfg.StripeProductBasePlan))
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"ok":           true,
		"email":        email,
		"freeLifetime": req.FreeLifetime,
		"status":       status,
	})
}

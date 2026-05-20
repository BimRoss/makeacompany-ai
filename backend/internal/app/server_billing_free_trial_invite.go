package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type billingFreeTrialInviteBody struct {
	Email string `json:"email"`
}

// handleBillingFreeTrialInvite sends the Joanne welcome email without requiring Stripe checkout.
func (s *Server) handleBillingFreeTrialInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.freeTrialInviteLimiter != nil {
		if ok, retry := s.freeTrialInviteLimiter.allow(clientIP(r)); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate limit exceeded"})
			return
		}
	}
	if strings.TrimSpace(s.cfg.ResendAPIKey) == "" || strings.TrimSpace(s.cfg.PortalAuthEmailFrom) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "email is not configured"})
		return
	}

	var body billingFreeTrialInviteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "email is required"})
		return
	}
	if !strings.Contains(email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid email"})
		return
	}

	if err := s.sendWelcomeInviteEmail(r.Context(), email); err != nil {
		s.log.Printf("free-trial invite email: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "unable to send invite email"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

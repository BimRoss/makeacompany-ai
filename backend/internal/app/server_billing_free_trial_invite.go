package app

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

type billingFreeTrialInviteBody struct {
	Email string `json:"email"`
	Ref   string `json:"ref"`
}

// inviteEmailRe is a conservative address shape: a sane local-part charset (no spaces, no display
// names, no braces), a domain, and a real TLD. It deliberately rejects the malformed addresses the
// free-trial-invite form was minting profiles from (e.g. "{}foo@gmail.com") and the no-TLD / angle-
// bracket junk that net/mail.ParseAddress would otherwise accept. See #494.
var inviteEmailRe = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// validInviteEmail reports whether email is a well-formed address we'll mint a trial profile for.
// email is expected already lower-cased and trimmed.
func validInviteEmail(email string) bool {
	if email == "" || len(email) > 254 { // RFC 5321 total-length ceiling
		return false
	}
	return inviteEmailRe.MatchString(email)
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
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	ref := strings.TrimSpace(body.Ref)
	if len(ref) > 64 {
		ref = ref[:64]
	}
	if email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "email is required"})
		return
	}
	if !validInviteEmail(email) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid email"})
		return
	}

	if err := s.sendWelcomeInviteEmail(r.Context(), email); err != nil {
		s.log.Printf("free-trial invite email: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "unable to send invite email"})
		return
	}

	if s.store != nil {
		if err := s.store.UpsertUserProfileFreeTrialInvite(r.Context(), email, ref, 0); err != nil {
			s.log.Printf("free-trial invite: persist profile %s: %v", email, err)
		}
		if _, err := s.AssignInitialLifecycleTier(r.Context(), email); err != nil {
			s.log.Printf("free-trial invite: assign lifecycle tier %s: %v", email, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

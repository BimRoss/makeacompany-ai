package app

import (
	"encoding/json"
	"net/http"
)

// adminCreditsRequest is the body for the admin credit lever (#797). Both fields
// are optional so one call can grant, comp, both, or neither:
//   - Grant > 0 adds that many credits (support top-up, OG comp allotment).
//   - Unlimited (when non-nil) sets or clears the never-metered comp flag.
type adminCreditsRequest struct {
	Email     string `json:"email"`
	Grant     int    `json:"grant"`
	Unlimited *bool  `json:"unlimited"`
}

// handleAdminUserCredits lets an authenticated admin grant credits and toggle the
// unlimited comp flag from the /admin Slack-users table. Keyed by email, the
// canonical profile hash key. Admin-session gated, same as the free-lifetime
// lever it sits beside; writes an audit line with the actor. Returns the fresh
// balance so the table updates without a refetch.
func (s *Server) handleAdminUserCredits(w http.ResponseWriter, r *http.Request) {
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
	var req adminCreditsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	email := normalizeProfileEmail(req.Email)
	if email == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "missing email"})
		return
	}
	if req.Grant < 0 {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "grant must be non-negative"})
		return
	}
	if req.Unlimited != nil {
		if err := s.store.SetCreditsUnlimited(r.Context(), email, *req.Unlimited); err != nil {
			s.log.Printf("admin set credits_unlimited email=%s by=%s: %v", email, session.Email, err)
			writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		s.log.Printf("audit: admin set credits_unlimited email=%s unlimited=%t actor=%s", email, *req.Unlimited, session.Email)
	}
	if req.Grant > 0 {
		if _, err := s.store.GrantCredits(r.Context(), email, req.Grant); err != nil {
			s.log.Printf("admin grant credits email=%s by=%s: %v", email, session.Email, err)
			writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		s.log.Printf("audit: admin grant credits email=%s grant=%d actor=%s", email, req.Grant, session.Email)
	}
	bal, err := s.store.GetCredits(r.Context(), email, s.cfg.CreditInitialGrant)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"ok":        true,
		"email":     email,
		"balance":   bal.Balance,
		"unlimited": bal.Unlimited,
	})
}

package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// marketingAuthorized validates the admin session bearer and additionally
// enforces the marketing-specific allowlist (issue #303). Returns the
// authenticated email on success.
func (s *Server) marketingAuthorized(r *http.Request) (email string, status int) {
	if !s.adminAuthEnabled() {
		return "", http.StatusServiceUnavailable
	}
	tok := tokenFromAuthHeader(r)
	session, err := s.validateAdminSession(r.Context(), tok)
	if err != nil {
		return "", http.StatusUnauthorized
	}
	if !s.marketingEmailAllowed(session.Email) {
		return "", http.StatusForbidden
	}
	return session.Email, 0
}

func (s *Server) marketingEmailAllowed(email string) bool {
	email = normalizeProfileEmail(email)
	if email == "" {
		return false
	}
	for _, allowed := range s.cfg.MarketingAllowlist {
		if normalizeProfileEmail(allowed) == email {
			return true
		}
	}
	return false
}

// handleAdminMarketingCampaigns dispatches /v1/admin/marketing/campaigns.
// GET → list newest-first; POST → create a new campaign tagged with the
// authenticated email.
func (s *Server) handleAdminMarketingCampaigns(w http.ResponseWriter, r *http.Request) {
	email, status := s.marketingAuthorized(r)
	if status != 0 {
		switch status {
		case http.StatusServiceUnavailable:
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		case http.StatusForbidden:
			http.Error(w, "forbidden", http.StatusForbidden)
		default:
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		list, err := s.store.ListMarketingCampaigns(r.Context())
		if err != nil {
			s.log.Printf("marketing campaigns list: %v", err)
			http.Error(w, "list error", http.StatusInternalServerError)
			return
		}
		writeJSONNoStore(w, http.StatusOK, map[string]any{"campaigns": list})
	case http.MethodPost:
		s.serveMarketingCampaignCreate(w, r, email)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) serveMarketingCampaignCreate(w http.ResponseWriter, r *http.Request, email string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8*1024))
	if err != nil {
		http.Error(w, "body too large or unreadable", http.StatusBadRequest)
		return
	}
	var c MarketingCampaign
	if len(body) > 0 {
		if err := json.Unmarshal(body, &c); err != nil {
			http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	// Identity comes from the verified session, never the body.
	c.CreatedByEmail = strings.ToLower(strings.TrimSpace(email))
	saved, err := s.store.SaveMarketingCampaign(r.Context(), c)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

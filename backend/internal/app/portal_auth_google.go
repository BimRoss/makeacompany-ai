package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"google.golang.org/api/idtoken"
)

type portalAuthGoogleFinishRequest struct {
	IDToken   string `json:"idToken"`
	ChannelID string `json:"channelId"`
}

func (s *Server) portalGoogleAuthEnabled() bool {
	return strings.TrimSpace(s.cfg.GoogleOAuthClientID) != ""
}

func (s *Server) handlePortalAuthGoogleFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.portalGoogleAuthEnabled() {
		http.Error(w, "google portal auth not configured", http.StatusServiceUnavailable)
		return
	}
	var req portalAuthGoogleFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	idTok := strings.TrimSpace(req.IDToken)
	chID := strings.TrimSpace(req.ChannelID)
	if idTok == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if _, err := s.store.GetCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID); err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "unknown channel", http.StatusNotFound)
			return
		}
		s.log.Printf("portal google finish get channel: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	payload, err := idtoken.Validate(r.Context(), idTok, strings.TrimSpace(s.cfg.GoogleOAuthClientID))
	if err != nil {
		s.log.Printf("portal google id token validate: %v", err)
		http.Error(w, "invalid id token", http.StatusUnauthorized)
		return
	}
	email := normalizeProfileEmail(fmt.Sprint(payload.Claims["email"]))
	if email == "" {
		http.Error(w, "missing email claim", http.StatusUnauthorized)
		return
	}
	if !googleEmailVerifiedClaim(payload.Claims["email_verified"]) {
		http.Error(w, "email not verified with google", http.StatusForbidden)
		return
	}
	ok, missing, err := s.assertPortalOwnerEmail(r.Context(), chID, email)
	if err != nil {
		s.log.Printf("portal google finish owner emails: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	if missing {
		http.Error(w, "unknown channel", http.StatusNotFound)
		return
	}
	if !ok {
		http.Error(w, "email not authorized for this company", http.StatusForbidden)
		return
	}
	s.writePortalMintResponse(w, r, email, chID)
}

func googleEmailVerifiedClaim(v any) bool {
	if v == nil {
		return true
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		s := strings.TrimSpace(strings.ToLower(t))
		return s == "true" || s == "1"
	default:
		return false
	}
}

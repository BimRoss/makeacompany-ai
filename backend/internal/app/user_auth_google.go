package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"google.golang.org/api/idtoken"
)

type userAuthGoogleFinishRequest struct {
	IDToken string `json:"idToken"`
}

func (s *Server) userGoogleAuthEnabled() bool {
	return strings.TrimSpace(s.cfg.GoogleOAuthClientID) != ""
}

func (s *Server) handleUserAuthGoogleFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.userGoogleAuthEnabled() {
		http.Error(w, "google user auth not configured", http.StatusServiceUnavailable)
		return
	}
	var req userAuthGoogleFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	idTok := strings.TrimSpace(req.IDToken)
	if idTok == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	payload, err := idtoken.Validate(r.Context(), idTok, strings.TrimSpace(s.cfg.GoogleOAuthClientID))
	if err != nil {
		s.log.Printf("user google id token validate: %v", err)
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
	s.writeUserMintResponse(w, r, email, "", "")
}

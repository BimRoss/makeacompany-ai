package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const userMagicLinkTTL = 30 * time.Minute

type userMagicStartRequest struct {
	Email string `json:"email"`
}

func (s *Server) userMagicEmailEnabled() bool {
	return strings.TrimSpace(s.cfg.ResendAPIKey) != "" && strings.TrimSpace(s.cfg.PortalAuthEmailFrom) != ""
}

func (s *Server) handleUserAuthMagicStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.userMagicEmailEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "magic_link_email_not_configured"})
		return
	}
	var req userMagicStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	email := normalizeProfileEmail(strings.TrimSpace(req.Email))
	if email == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	token, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create sign-in token", http.StatusInternalServerError)
		return
	}
	if err := s.store.SetUserMagicLink(r.Context(), token, email, userMagicLinkTTL); err != nil {
		s.log.Printf("user magic set link: %v", err)
		http.Error(w, "unable to store sign-in token", http.StatusInternalServerError)
		return
	}
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/api/me/auth/email/callback?" + url.Values{
		"token": {token},
	}.Encode()
	sendErr := s.sendChannelUserStyleMagicLinkEmail(r.Context(), email, link)
	if sendErr != nil {
		s.log.Printf("user magic resend: %v", sendErr)
		_ = s.store.DeleteUserMagicLink(r.Context(), token)
		http.Error(w, "unable to send email", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sent": true})
}

func (s *Server) handleUserAuthMagicFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if len(token) < 16 {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}
	email, err := s.store.ConsumeUserMagicLink(r.Context(), token)
	if err == redis.Nil {
		http.Error(w, "invalid or expired link", http.StatusUnauthorized)
		return
	}
	if err != nil {
		s.log.Printf("user magic consume: %v", err)
		http.Error(w, "unable to verify link", http.StatusInternalServerError)
		return
	}
	s.writeUserMintResponse(w, r, email)
}

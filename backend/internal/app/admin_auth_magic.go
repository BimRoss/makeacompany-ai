package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const adminMagicLinkTTL = 30 * time.Minute

type adminMagicStartRequest struct {
	Email string `json:"email"`
}

func (s *Server) handleAdminAuthMagicStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.portalMagicEmailEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "magic_link_email_not_configured"})
		return
	}
	if !s.adminAuthEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "admin_auth_disabled"})
		return
	}
	var req adminMagicStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	email := normalizeProfileEmail(strings.TrimSpace(req.Email))
	if email == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !adminSignInEmailAllowed(email) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	token, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create sign-in token", http.StatusInternalServerError)
		return
	}
	if err := s.store.SetAdminMagicLink(r.Context(), token, email, adminMagicLinkTTL); err != nil {
		s.log.Printf("admin magic set link: %v", err)
		http.Error(w, "unable to store sign-in token", http.StatusInternalServerError)
		return
	}
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/api/admin/auth/email/callback?" + url.Values{
		"token": {token},
	}.Encode()
	subject := "Your admin dashboard sign-in link"
	plain := fmt.Sprintf("Open this link to sign in to the admin dashboard (expires in 30 minutes):\n\n%s\n", link)
	html := fmt.Sprintf(`<p>Sign in to the makeacompany admin dashboard.</p><p><a href="%s">Continue to admin</a></p><p>This link expires in 30 minutes.</p>`, link)
	if err := sendEmailViaResend(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, email, subject, plain, html); err != nil {
		s.log.Printf("admin magic resend: %v", err)
		_ = s.store.DeleteAdminMagicLink(r.Context(), token)
		http.Error(w, "unable to send email", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminAuthMagicFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if len(token) < 16 {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}
	email, err := s.store.ConsumeAdminMagicLink(r.Context(), token)
	if err == redis.Nil {
		http.Error(w, "invalid or expired link", http.StatusUnauthorized)
		return
	}
	if err != nil {
		s.log.Printf("admin magic consume: %v", err)
		http.Error(w, "unable to verify link", http.StatusInternalServerError)
		return
	}
	if !adminSignInEmailAllowed(email) {
		http.Error(w, "unauthorized email", http.StatusForbidden)
		return
	}
	s.writeAdminMintResponse(w, r, email)
}

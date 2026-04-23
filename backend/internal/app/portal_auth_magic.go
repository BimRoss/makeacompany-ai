package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const portalMagicLinkTTL = 30 * time.Minute

type portalMagicStartRequest struct {
	ChannelID string `json:"channelId"`
	Email     string `json:"email"`
}

func (s *Server) portalMagicEmailEnabled() bool {
	return strings.TrimSpace(s.cfg.ResendAPIKey) != "" && strings.TrimSpace(s.cfg.PortalAuthEmailFrom) != ""
}

func (s *Server) handlePortalAuthMagicStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.portalMagicEmailEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "magic_link_email_not_configured"})
		return
	}
	var req portalMagicStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	email := normalizeProfileEmail(strings.TrimSpace(req.Email))
	if !ValidSlackChannelID(chID) || email == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if _, err := s.store.GetCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID); err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "unknown channel", http.StatusNotFound)
			return
		}
		s.log.Printf("portal magic start get channel: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	ok, _, err := s.assertPortalOwnerEmail(r.Context(), chID, email)
	if err != nil {
		s.log.Printf("portal magic start owner emails: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	// Do not reveal whether the address is an owner.
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	token, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create sign-in token", http.StatusInternalServerError)
		return
	}
	if err := s.store.SetPortalMagicLink(r.Context(), token, chID, email, portalMagicLinkTTL); err != nil {
		s.log.Printf("portal magic set link: %v", err)
		http.Error(w, "unable to store sign-in token", http.StatusInternalServerError)
		return
	}
	link := strings.TrimRight(s.cfg.AppBaseURL, "/") + "/api/portal/auth/email/callback?" + url.Values{
		"token": {token},
		"cid":   {chID},
	}.Encode()
	subject := "Your company portal sign-in link"
	plain := fmt.Sprintf("Open this link to sign in (expires in 30 minutes):\n\n%s\n", link)
	html := fmt.Sprintf(`<p>Sign in to your company portal.</p><p><a href="%s">Continue to portal</a></p><p>This link expires in 30 minutes.</p>`, link)
	if err := sendEmailViaResend(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, email, subject, plain, html); err != nil {
		s.log.Printf("portal magic resend: %v", err)
		_ = s.store.DeletePortalMagicLink(r.Context(), token)
		http.Error(w, "unable to send email", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handlePortalAuthMagicFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if len(token) < 16 {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}
	chID, email, err := s.store.ConsumePortalMagicLink(r.Context(), token)
	if err == redis.Nil {
		http.Error(w, "invalid or expired link", http.StatusUnauthorized)
		return
	}
	if err != nil {
		s.log.Printf("portal magic consume: %v", err)
		http.Error(w, "unable to verify link", http.StatusInternalServerError)
		return
	}
	ok, missing, err := s.assertPortalOwnerEmail(r.Context(), chID, email)
	if err != nil {
		s.log.Printf("portal magic finish owner emails: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	if missing || !ok {
		http.Error(w, "email not authorized for this company", http.StatusForbidden)
		return
	}
	s.writePortalMintResponse(w, r, email, chID)
}

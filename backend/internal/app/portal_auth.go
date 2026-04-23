package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type portalAuthFinishResponse struct {
	Email        string `json:"email"`
	ChannelID    string `json:"channelId"`
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

// writePortalMintResponse persists a portal session after the caller has verified the email
// (Google id_token, magic link, etc.) and writes the same JSON shape as the legacy Stripe finish response.
func (s *Server) writePortalMintResponse(w http.ResponseWriter, r *http.Request, email, chID string) {
	email = normalizeProfileEmail(email)
	chID = strings.TrimSpace(chID)
	if email == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	sessionToken, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create portal session", http.StatusInternalServerError)
		return
	}
	ttlSec := s.cfg.AdminSessionTTLSec
	if ttlSec <= 0 {
		ttlSec = 43200
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSec) * time.Second)
	if err := s.store.CreatePortalSession(r.Context(), sessionToken, email, chID, expiresAt); err != nil {
		http.Error(w, "unable to persist portal session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, portalAuthFinishResponse{
		Email:        email,
		ChannelID:    chID,
		SessionToken: sessionToken,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
	})
}

// portalOwnerEmails returns owner emails for a company channel or an error (including ErrCompanyChannelNotFound).
func (s *Server) portalOwnerEmails(ctx context.Context, chID string) ([]string, error) {
	return s.store.OwnerEmailsForCompanyChannel(ctx, s.cfg.CompanyChannelsRedisKey, chID)
}

// assertPortalOwnerEmail returns false if email is not an owner for chID (channel must exist).
func (s *Server) assertPortalOwnerEmail(ctx context.Context, chID, email string) (allowed bool, channelMissing bool, err error) {
	allowedList, err := s.portalOwnerEmails(ctx, chID)
	if err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			return false, true, nil
		}
		return false, false, err
	}
	return emailInListFold(allowedList, normalizeProfileEmail(email)), false, nil
}

func emailInListFold(list []string, email string) bool {
	for _, x := range list {
		if strings.EqualFold(strings.TrimSpace(x), email) {
			return true
		}
	}
	return false
}

func (s *Server) validatePortalSessionForChannel(ctx context.Context, token, wantChannelID string) (PortalSession, error) {
	token = strings.TrimSpace(token)
	wantChannelID = strings.TrimSpace(wantChannelID)
	if token == "" || wantChannelID == "" {
		return PortalSession{}, fmt.Errorf("missing portal token or channel")
	}
	session, err := s.store.GetPortalSession(ctx, token)
	if err == redis.Nil {
		return PortalSession{}, fmt.Errorf("invalid portal session")
	}
	if err != nil {
		return PortalSession{}, err
	}
	if !strings.EqualFold(session.ChannelID, wantChannelID) {
		return PortalSession{}, fmt.Errorf("portal session channel mismatch")
	}
	return session, nil
}

func (s *Server) handlePortalAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         session.Email,
		"channelId":     session.ChannelID,
		"expiresAt":     session.ExpiresAt,
	})
}

func (s *Server) handlePortalAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_ = s.store.DeletePortalSession(context.Background(), tokenFromAuthHeader(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

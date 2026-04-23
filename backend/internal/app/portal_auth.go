package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
)

type portalAuthStartRequest struct {
	SuccessURL string `json:"successUrl"`
	CancelURL  string `json:"cancelUrl"`
	ChannelID  string `json:"channelId"`
}

type portalAuthFinishResponse struct {
	Email        string `json:"email"`
	ChannelID    string `json:"channelId"`
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

func (s *Server) portalStripeEnabled() bool {
	return strings.TrimSpace(stripe.Key) != ""
}

func (s *Server) handlePortalAuthStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.portalStripeEnabled() {
		http.Error(w, "stripe is not configured", http.StatusServiceUnavailable)
		return
	}
	var req portalAuthStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	successURL := strings.TrimSpace(req.SuccessURL)
	cancelURL := strings.TrimSpace(req.CancelURL)
	if successURL == "" || cancelURL == "" {
		http.Error(w, "missing successUrl/cancelUrl", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	if _, err := s.store.GetCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID); err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "unknown channel", http.StatusNotFound)
			return
		}
		s.log.Printf("portal auth start get channel: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	params := &stripe.CheckoutSessionParams{
		Mode:               stripe.String(string(stripe.CheckoutSessionModeSetup)),
		SuccessURL:         stripe.String(successURL),
		CancelURL:          stripe.String(cancelURL),
		ClientReferenceID:  stripe.String(chID),
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
	}
	sess, err := checkoutsession.New(params)
	if err != nil {
		s.log.Printf("portal auth start checkout: %v", err)
		http.Error(w, "unable to create stripe auth session", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":       sess.URL,
		"sessionId": sess.ID,
	})
}

func (s *Server) handlePortalAuthFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.portalStripeEnabled() {
		http.Error(w, "stripe is not configured", http.StatusServiceUnavailable)
		return
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" || !strings.HasPrefix(sessionID, "cs_") {
		http.Error(w, "invalid session_id", http.StatusBadRequest)
		return
	}
	sess, err := checkoutsession.Get(sessionID, nil)
	if err != nil {
		s.log.Printf("portal auth finish retrieve session: %v", err)
		http.Error(w, "unable to retrieve checkout session", http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(string(sess.Status)), "complete") {
		http.Error(w, "checkout session not complete", http.StatusUnauthorized)
		return
	}
	chID := strings.TrimSpace(sess.ClientReferenceID)
	if !ValidSlackChannelID(chID) {
		http.Error(w, "invalid client reference channel", http.StatusBadRequest)
		return
	}
	email := sessionEmailFromCheckout(sess)
	email = normalizeProfileEmail(email)
	if email == "" {
		http.Error(w, "missing checkout email", http.StatusUnauthorized)
		return
	}
	allowed, err := s.store.OwnerEmailsForCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID)
	if err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "unknown channel", http.StatusNotFound)
			return
		}
		s.log.Printf("portal auth finish owner emails: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	if !emailInListFold(allowed, email) {
		http.Error(w, "email not authorized for this company", http.StatusForbidden)
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
	if !s.portalStripeEnabled() {
		http.Error(w, "stripe is not configured", http.StatusServiceUnavailable)
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

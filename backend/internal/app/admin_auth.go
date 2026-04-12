package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
)

type adminAuthStartRequest struct {
	SuccessURL string `json:"successUrl"`
	CancelURL  string `json:"cancelUrl"`
}

type adminAuthFinishResponse struct {
	Email        string `json:"email"`
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

func randomTokenHex(sizeBytes int) (string, error) {
	if sizeBytes < 16 {
		sizeBytes = 16
	}
	buf := make([]byte, sizeBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func sessionEmailFromCheckout(sess *stripe.CheckoutSession) string {
	if sess == nil {
		return ""
	}
	if sess.CustomerDetails != nil {
		if email := strings.ToLower(strings.TrimSpace(sess.CustomerDetails.Email)); email != "" {
			return email
		}
	}
	return strings.ToLower(strings.TrimSpace(sess.CustomerEmail))
}

func (s *Server) adminAuthEnabled() bool {
	return strings.TrimSpace(s.cfg.AdminAllowedEmail) != ""
}

func (s *Server) handleAdminAuthStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	var req adminAuthStartRequest
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

	params := &stripe.CheckoutSessionParams{
		Mode:          stripe.String(string(stripe.CheckoutSessionModeSetup)),
		SuccessURL:    stripe.String(successURL),
		CancelURL:     stripe.String(cancelURL),
		CustomerEmail: stripe.String(strings.TrimSpace(s.cfg.AdminAllowedEmail)),
	}
	sess, err := checkoutsession.New(params)
	if err != nil {
		s.log.Printf("admin auth start checkout: %v", err)
		http.Error(w, "unable to create stripe auth session", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":       sess.URL,
		"sessionId": sess.ID,
	})
}

func (s *Server) handleAdminAuthFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" || !strings.HasPrefix(sessionID, "cs_") {
		http.Error(w, "invalid session_id", http.StatusBadRequest)
		return
	}
	sess, err := checkoutsession.Get(sessionID, nil)
	if err != nil {
		s.log.Printf("admin auth finish retrieve session: %v", err)
		http.Error(w, "unable to retrieve checkout session", http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(string(sess.Status)), "complete") {
		http.Error(w, "checkout session not complete", http.StatusUnauthorized)
		return
	}
	email := sessionEmailFromCheckout(sess)
	if !strings.EqualFold(email, strings.TrimSpace(s.cfg.AdminAllowedEmail)) {
		http.Error(w, "unauthorized email", http.StatusUnauthorized)
		return
	}
	sessionToken, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create admin session", http.StatusInternalServerError)
		return
	}
	ttlSec := s.cfg.AdminSessionTTLSec
	if ttlSec <= 0 {
		ttlSec = 43200
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSec) * time.Second)
	if err := s.store.CreateAdminSession(r.Context(), sessionToken, email, expiresAt); err != nil {
		http.Error(w, "unable to persist admin session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, adminAuthFinishResponse{
		Email:        email,
		SessionToken: sessionToken,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
	})
}

func tokenFromAuthHeader(r *http.Request) string {
	if r == nil {
		return ""
	}
	if v := strings.TrimSpace(r.Header.Get("X-Admin-Session")); v != "" {
		return v
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
}

func (s *Server) validateAdminSession(ctx context.Context, token string) (AdminSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AdminSession{}, fmt.Errorf("missing session token")
	}
	session, err := s.store.GetAdminSession(ctx, token)
	if err == redis.Nil {
		return AdminSession{}, fmt.Errorf("invalid session")
	}
	if err != nil {
		return AdminSession{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(session.ExpiresAt))
	if err != nil || expiresAt.Before(time.Now().UTC()) {
		_ = s.store.DeleteAdminSession(ctx, token)
		return AdminSession{}, fmt.Errorf("expired session")
	}
	if !strings.EqualFold(strings.TrimSpace(session.Email), strings.TrimSpace(s.cfg.AdminAllowedEmail)) {
		return AdminSession{}, fmt.Errorf("unauthorized session")
	}
	return session, nil
}

func (s *Server) handleAdminAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	session, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         session.Email,
		"expiresAt":     session.ExpiresAt,
	})
}

func (s *Server) handleAdminAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	_ = s.store.DeleteAdminSession(context.Background(), tokenFromAuthHeader(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// adminSignInAllowlist is the only emails that may complete admin Google or magic-link sign-in.
// Hardcoded (not env) so dev and prod stay aligned.
var adminSignInAllowlist = []string{
	"grant@bimross.com",
	"grantdfoster@gmail.com",
}

func adminSignInEmailAllowed(email string) bool {
	email = normalizeProfileEmail(email)
	if email == "" {
		return false
	}
	for _, allowed := range adminSignInAllowlist {
		if normalizeProfileEmail(allowed) == email {
			return true
		}
	}
	return false
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

func (s *Server) writeAdminMintResponse(w http.ResponseWriter, r *http.Request, email string) {
	email = normalizeProfileEmail(email)
	if email == "" || !adminSignInEmailAllowed(email) {
		http.Error(w, "bad request", http.StatusBadRequest)
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

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// adminReadAuthorized allows read when the Bearer matches BACKEND_INTERNAL_SERVICE_TOKEN, or when
// the Bearer is a valid admin session (Google / magic-link sign-in).
func (s *Server) adminReadAuthorized(r *http.Request) (ok bool, serviceUnavailable bool) {
	got := strings.TrimSpace(tokenFromAuthHeader(r))
	want := strings.TrimSpace(s.cfg.BackendInternalServiceToken)
	if want != "" && got != "" && constantTimeEqual(got, want) {
		return true, false
	}
	if !s.adminAuthEnabled() {
		return false, true
	}
	if _, err := s.validateAdminSession(r.Context(), got); err != nil {
		return false, false
	}
	return true, false
}

// companyChannelsAdminAuthorized gates registry/list/get/discover/patch for company channels.
// When BACKEND_INTERNAL_SERVICE_TOKEN is set on the backend, requests must send
// Authorization: Bearer <same token>. When unset (typical local dev), requests are allowed without a bearer.
func (s *Server) companyChannelsAdminAuthorized(r *http.Request) bool {
	got := strings.TrimSpace(tokenFromAuthHeader(r))
	want := strings.TrimSpace(s.cfg.BackendInternalServiceToken)
	if want == "" {
		return true
	}
	return got != "" && constantTimeEqual(got, want)
}

func (s *Server) companyRegistryReadAuthorized(r *http.Request) (ok bool, serviceUnavailable bool) {
	return s.companyChannelsAdminAuthorized(r), false
}

func (s *Server) companyChannelPatchAuthorized(r *http.Request) (ok bool, serviceUnavailable bool) {
	return s.companyChannelsAdminAuthorized(r), false
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

func (s *Server) adminAuthEnabled() bool {
	return len(adminSignInAllowlist) > 0
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
	if !adminSignInEmailAllowed(session.Email) {
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

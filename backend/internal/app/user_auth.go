package app

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type userAuthFinishResponse struct {
	Email        string `json:"email"`
	TenantType   string `json:"tenantType"`
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

// writeUserMintResponse persists a user-scope portal session after the caller has verified the email
// (Google id_token, magic link, etc.). Mirrors writePortalMintResponse but skips the channel piece.
func (s *Server) writeUserMintResponse(w http.ResponseWriter, r *http.Request, email string) {
	email = normalizeProfileEmail(email)
	if email == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	sessionToken, err := randomTokenHex(32)
	if err != nil {
		http.Error(w, "unable to create user session", http.StatusInternalServerError)
		return
	}
	ttlSec := s.cfg.AdminSessionTTLSec
	if ttlSec <= 0 {
		ttlSec = 43200
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSec) * time.Second)
	if err := s.store.CreatePortalSession(r.Context(), sessionToken, email, "", PortalTenantTypeUser, expiresAt); err != nil {
		http.Error(w, "unable to persist user session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, userAuthFinishResponse{
		Email:        email,
		TenantType:   PortalTenantTypeUser,
		SessionToken: sessionToken,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
	})
}

func (s *Server) handleUserAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	billing := map[string]any{
		"hasManageableSubscription": false,
		"subscriptionStatus":        "",
		"cancelAtPeriodEnd":         false,
	}
	slackUserID := ""
	freeLifetime := false
	tier := ""
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("user auth me billing profile: %v", err)
	} else {
		billing = portalBillingPublicJSON(row)
		slackUserID = strings.TrimSpace(row.SlackUserID)
		freeLifetime = row.FreeLifetime
		tier = strings.TrimSpace(row.Tier)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         session.Email,
		"tenantType":    session.TenantType,
		"expiresAt":     session.ExpiresAt,
		"slackUserId":   slackUserID,
		"tier":          tier,
		"freeLifetime":  freeLifetime,
		"billing":       billing,
	})
}

func (s *Server) handleUserAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_ = s.store.DeletePortalSession(context.Background(), tokenFromAuthHeader(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type portalAuthFinishResponse struct {
	Email        string `json:"email"`
	ChannelID    string `json:"channelId"`
	TenantType   string `json:"tenantType"`
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

// writePortalMintResponse persists a company-scope portal session after the caller has verified the email
// (Google id_token, magic link, etc.) and writes the same JSON shape as the legacy Stripe finish response.
func (s *Server) writePortalMintResponse(w http.ResponseWriter, r *http.Request, email, chID string) {
	email = normalizeProfileEmail(email)
	chID = strings.TrimSpace(chID)
	if email == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.writePortalSession(w, r, email, chID, PortalTenantTypeCompany)
}

// writePortalPersonalMintResponse persists a personal-scope portal session
// (no channel). Issued by /v1/portal/auth/personal/* finish endpoints —
// the entry point for /me/login from the frontend.
func (s *Server) writePortalPersonalMintResponse(w http.ResponseWriter, r *http.Request, email string) {
	email = normalizeProfileEmail(email)
	if email == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.writePortalSession(w, r, email, "", PortalTenantTypePersonal)
}

func (s *Server) writePortalSession(w http.ResponseWriter, r *http.Request, email, chID, tenantType string) {
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
	if err := s.store.CreatePortalSession(r.Context(), sessionToken, email, chID, tenantType, expiresAt); err != nil {
		http.Error(w, "unable to persist portal session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, portalAuthFinishResponse{
		Email:        email,
		ChannelID:    chID,
		TenantType:   tenantType,
		SessionToken: sessionToken,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
	})
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
	billing := map[string]any{
		"hasManageableSubscription": false,
		"subscriptionStatus":        "",
		"cancelAtPeriodEnd":         false,
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("portal auth me billing profile: %v", err)
	} else {
		billing = portalBillingPublicJSON(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         session.Email,
		"channelId":     session.ChannelID,
		"tenantType":    session.TenantType,
		"expiresAt":     session.ExpiresAt,
		"billing":       billing,
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

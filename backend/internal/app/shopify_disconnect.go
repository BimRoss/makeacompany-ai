package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// handleShopifyDisconnect — the portal user revokes their Shopify
// connection. Symmetric to handlePortalWorkspaceDisconnectFinish:
//   1. validate portal session for the channel,
//   2. resolve email → slack_user_id,
//   3. delete the K8s Secret (returns the prior shop + access_token),
//   4. best-effort DELETE /admin/api/<v>/api_permissions/current.json
//      against the shop using that access_token,
//   5. always 200 even if Shopify-side revocation fails — the user wants
//      it gone on our side regardless; a stale Shopify-side token
//      cleans up the moment Shopify rotates it.
//
// POST /v1/integrations/shopify/disconnect
// Body: { channelId }
const shopifyRevokeURLFmt = "https://%s/admin/api/2025-01/api_permissions/current.json"

type shopifyDisconnectRequest struct {
	ChannelID string `json:"channelId"`
}

type shopifyDisconnectResponse struct {
	OK      bool `json:"ok"`
	Revoked bool `json:"revoked"`
}

func (s *Server) handleShopifyDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.shopify.Disabled() {
		http.Error(w, "shopify integration not configured", http.StatusServiceUnavailable)
		return
	}

	var req shopifyDisconnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	session, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), chID)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("shopify disconnect: slack_user_id lookup for %s: %v", session.Email, err)
		http.Error(w, "user profile lookup failed", http.StatusInternalServerError)
		return
	}
	if slackUserID == "" {
		http.Error(w, "no slack user id on file for this email", http.StatusForbidden)
		return
	}

	shop, accessToken, delErr := s.shopify.DeleteShopifyConnection(r.Context(), slackUserID)
	if delErr != nil {
		s.log.Printf("shopify disconnect: secret delete for slack_user=%s: %v", slackUserID, delErr)
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}

	revoked := false
	if shop != "" && accessToken != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		if err := s.revokeShopifyAccess(ctx, shop, accessToken); err != nil {
			s.log.Printf("shopify disconnect: revoke at shop=%s: %v", shop, err)
		} else {
			revoked = true
		}
		cancel()
	}

	writeJSON(w, http.StatusOK, shopifyDisconnectResponse{OK: true, Revoked: revoked})
}

func (s *Server) revokeShopifyAccess(ctx context.Context, shop, accessToken string) error {
	endpoint := fmt.Sprintf(shopifyRevokeURLFmt, shop)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	client := s.shopifyHTTPClient()
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("delete api_permissions: %w", err)
	}
	defer resp.Body.Close()
	// 200 + 401/403 (token already invalid) all count as "successfully gone."
	switch resp.StatusCode {
	case http.StatusOK, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return nil
	default:
		return fmt.Errorf("shopify revoke status %d", resp.StatusCode)
	}
}

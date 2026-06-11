package app

import (
	"errors"
	"net/http"
	"strings"
)

// handleInternalShopifyToken returns the stored Shopify connection for a
// Slack user, keyed off slack_user_id. Bearer-gated with the same
// BACKEND_INTERNAL_SERVICE_TOKEN the harness uses for /v1/internal/deploy-gate
// and the existing trial-gating endpoints. Mirrors that exact shape.
//
// GET /v1/internal/shopify-token?slack_user_id=U…
//
// Responses:
//
//	200 { shop_domain, access_token, scopes }   — connection exists
//	404                                          — user has no Shopify connection
//	401                                          — bearer missing/wrong
//
// The harness caches the response in-pod for ≤60s (per claude-code-ross
// trial_gate.go pattern) so a disconnect propagates within the cache TTL.
func (s *Server) handleInternalShopifyToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if s.shopify.Disabled() {
		http.Error(w, "shopify integration not configured", http.StatusServiceUnavailable)
		return
	}
	slackUserID := strings.TrimSpace(r.URL.Query().Get("slack_user_id"))
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	conn, err := s.shopify.GetShopifyConnection(r.Context(), slackUserID)
	if errors.Is(err, ErrShopifyNotConnected) {
		http.Error(w, "not connected", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Printf("internal shopify token: lookup for slack_user=%s: %v", slackUserID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "lookup failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"shop_domain":  conn.ShopDomain,
		"access_token": conn.AccessToken,
		"scopes":       conn.Scopes,
	})
}

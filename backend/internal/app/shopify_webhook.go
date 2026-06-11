package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
)

// handleShopifyWebhook receives Shopify-signed webhooks (orders/create,
// products/update, etc.) and verifies HMAC before doing anything else.
// Layer 1 ships HMAC verification + shop→user resolution + structured
// log. Full harness dispatch (synthesized inbound message) lands when
// the corresponding receiver exists in claude-code-ross — tracked in
// claude-code-ross#358.
//
// POST /v1/integrations/shopify/webhook
//
// Required Shopify headers:
//
//	X-Shopify-Topic           orders/create, products/update, …
//	X-Shopify-Shop-Domain     <shop>.myshopify.com
//	X-Shopify-Hmac-Sha256     base64(HMAC-SHA256(body, client_secret))
//
// On HMAC failure we respond 401 WITHOUT echoing the topic / shop, so a
// scanner can't probe for which routes are gated.

const (
	headerShopifyHMAC  = "X-Shopify-Hmac-Sha256"
	headerShopifyTopic = "X-Shopify-Topic"
	headerShopifyShop  = "X-Shopify-Shop-Domain"

	shopifyWebhookBodyLimit = 5 * 1024 * 1024 // 5 MB — Shopify caps at 1 MB; cushion.
)

func (s *Server) handleShopifyWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.shopifyConfigured() {
		// Don't even reveal the route is configured if the app isn't.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, shopifyWebhookBodyLimit))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	sent := strings.TrimSpace(r.Header.Get(headerShopifyHMAC))
	if !verifyShopifyWebhookHMAC(body, sent, s.cfg.ShopifyPartnerClientSecret) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	topic := strings.TrimSpace(r.Header.Get(headerShopifyTopic))
	shop := strings.ToLower(strings.TrimSpace(r.Header.Get(headerShopifyShop)))
	if topic == "" || !ValidShopifyShopDomain(shop) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if s.shopify.Disabled() {
		// HMAC verified — webhook is real — but we can't resolve to a
		// user in this environment (local dev). Ack so Shopify doesn't
		// retry-storm us.
		s.log.Printf("shopify webhook: writer disabled; acking topic=%s shop=%s bytes=%d", topic, shop, len(body))
		w.WriteHeader(http.StatusOK)
		return
	}

	conn, err := s.shopify.GetShopifyConnectionByShop(r.Context(), shop)
	if errors.Is(err, ErrShopifyNotConnected) {
		// Shop isn't connected on our side anymore (race with disconnect,
		// or someone fat-fingered a webhook URL into a shop we never
		// installed on). Ack so Shopify doesn't keep retrying, but log.
		s.log.Printf("shopify webhook: unknown shop topic=%s shop=%s bytes=%d", topic, shop, len(body))
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		s.log.Printf("shopify webhook: shop lookup topic=%s shop=%s: %v", topic, shop, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Layer 1 v1: log + ack. Harness-side dispatcher (synthesized inbound
	// Slack message tagged `[from: shopify webhook <topic>]`) lands as a
	// follow-up under claude-code-ross#358 once the receiver exists.
	s.log.Printf("shopify webhook: topic=%s shop=%s slack_user=%s bytes=%d ok=true",
		topic, shop, conn.SlackUserID, len(body))
	w.WriteHeader(http.StatusOK)
}

// verifyShopifyWebhookHMAC computes HMAC-SHA256(body, clientSecret),
// base64-encodes it, and constant-time-compares to the sent header.
// Empty header or wrong shape returns false without doing the compare.
func verifyShopifyWebhookHMAC(body []byte, sentBase64, clientSecret string) bool {
	sent := strings.TrimSpace(sentBase64)
	if sent == "" || clientSecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(clientSecret))
	mac.Write(body)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if len(expected) != len(sent) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(sent)) == 1
}

package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Shopify Partner OAuth — Layer 1 of makeacompany-ai#352.
//
// Two public endpoints, both browser-driven via the makeacompany.ai
// portal:
//
//   POST /v1/integrations/shopify/connect/start
//     - portal-session-authed (channel-scoped, mirrors workspace pattern)
//     - body: { channelId, shop }
//     - generates a single-use nonce in Redis, returns { authUrl }
//     - frontend redirects browser to authUrl
//
//   GET /v1/integrations/shopify/callback
//     - unauthed (Shopify is the caller, via browser redirect)
//     - query: code, state, shop, hmac, timestamp
//     - verifies Shopify HMAC over the other query params
//     - consumes the nonce; binds (slack_user_id, shop) and writes the
//       per-user K8s Secret with the access_token from Shopify's exchange
//     - 302 → {AppBaseURL}/integrations/shopify?status=connected&shop=…
//
// The access token never appears in a response body or query param.

const (
	shopifyOAuthScopes      = "read_products,write_products,read_inventory,write_inventory,read_orders,read_customers,read_themes,write_themes,read_content,write_content,read_locations"
	shopifyOAuthAuthURLFmt  = "https://%s/admin/oauth/authorize?client_id=%s&scope=%s&redirect_uri=%s&state=%s"
	shopifyOAuthTokenURLFmt = "https://%s/admin/oauth/access_token"
	shopifyOAuthNonceBytes  = 32 // 64 hex chars
)

type shopifyConnectStartRequest struct {
	ChannelID string `json:"channelId"`
	Shop      string `json:"shop"`
}

type shopifyConnectStartResponse struct {
	AuthURL string `json:"authUrl"`
}

type shopifyTokenExchangeResponse struct {
	AccessToken string `json:"access_token"`
	Scope       string `json:"scope"`
}

// handleShopifyConnectStart authenticates the portal user, allocates a
// one-time nonce, and returns the Shopify authorize URL to redirect to.
func (s *Server) handleShopifyConnectStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.shopifyConfigured() {
		http.Error(w, "shopify integration not configured", http.StatusServiceUnavailable)
		return
	}
	if s.shopify.Disabled() {
		http.Error(w, "shopify integration not configured", http.StatusServiceUnavailable)
		return
	}

	var req shopifyConnectStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	shop := strings.ToLower(strings.TrimSpace(req.Shop))
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !ValidShopifyShopDomain(shop) {
		http.Error(w, "shop must look like <name>.myshopify.com", http.StatusBadRequest)
		return
	}

	session, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), chID)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("shopify connect start: slack_user_id lookup for %s: %v", session.Email, err)
		http.Error(w, "user profile lookup failed", http.StatusInternalServerError)
		return
	}
	if slackUserID == "" {
		// Connect flow assumes a Slack user record; harness keys off it.
		http.Error(w, "no slack user id on file for this email", http.StatusForbidden)
		return
	}

	nonce, err := randomHexNonce(shopifyOAuthNonceBytes)
	if err != nil {
		s.log.Printf("shopify connect start: nonce gen: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := s.store.SetShopifyOAuthNonce(r.Context(), nonce, session.Email, chID, shop, slackUserID, 0); err != nil {
		s.log.Printf("shopify connect start: nonce persist: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	authURL := fmt.Sprintf(
		shopifyOAuthAuthURLFmt,
		shop,
		url.QueryEscape(s.cfg.ShopifyPartnerClientID),
		url.QueryEscape(shopifyOAuthScopes),
		url.QueryEscape(s.shopifyCallbackURL()),
		url.QueryEscape(nonce),
	)
	writeJSON(w, http.StatusOK, shopifyConnectStartResponse{AuthURL: authURL})
}

// handleShopifyCallback receives the Shopify-driven browser redirect,
// verifies HMAC, exchanges code → access_token, writes the per-user
// Secret, redirects to the portal success page.
func (s *Server) handleShopifyCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.shopifyConfigured() || s.shopify.Disabled() {
		http.Error(w, "shopify integration not configured", http.StatusServiceUnavailable)
		return
	}

	q := r.URL.Query()
	code := strings.TrimSpace(q.Get("code"))
	state := strings.TrimSpace(q.Get("state"))
	shop := strings.ToLower(strings.TrimSpace(q.Get("shop")))
	if code == "" || state == "" || !ValidShopifyShopDomain(shop) {
		s.shopifyCallbackError(w, r, "bad_request")
		return
	}

	if !verifyShopifyCallbackHMAC(q, s.cfg.ShopifyPartnerClientSecret) {
		s.shopifyCallbackError(w, r, "bad_hmac")
		return
	}

	email, chID, savedShop, slackUserID, err := s.store.ConsumeShopifyOAuthNonce(r.Context(), state)
	if err != nil {
		s.log.Printf("shopify callback: nonce consume: %v", err)
		s.shopifyCallbackError(w, r, "expired_state")
		return
	}
	if !strings.EqualFold(savedShop, shop) {
		// Shop substitution attempt — user started flow for shop A but
		// Shopify redirected from shop B. Reject.
		s.log.Printf("shopify callback: shop mismatch state=%s saved=%q got=%q",
			redactNonce(state), savedShop, shop)
		s.shopifyCallbackError(w, r, "shop_mismatch")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	accessToken, scopes, err := s.exchangeShopifyCode(ctx, shop, code)
	if err != nil {
		s.log.Printf("shopify callback: token exchange for shop=%s: %v", shop, err)
		s.shopifyCallbackError(w, r, "exchange_failed")
		return
	}

	conn := ShopifyConnection{
		SlackUserID: slackUserID,
		ShopDomain:  shop,
		AccessToken: accessToken,
		Scopes:      scopes,
		InstalledAt: time.Now().UTC(),
	}
	if err := s.shopify.WriteShopifyConnection(ctx, conn); err != nil {
		s.log.Printf("shopify callback: secret write for slack_user=%s shop=%s: %v", slackUserID, shop, err)
		s.shopifyCallbackError(w, r, "write_failed")
		return
	}

	s.log.Printf("shopify callback: connection written email=%s channel=%s shop=%s slack_user=%s scopes=%d",
		email, chID, shop, slackUserID, len(scopes))

	redirectURL := fmt.Sprintf("%s/integrations/shopify?status=connected&shop=%s",
		strings.TrimRight(s.cfg.AppBaseURL, "/"),
		url.QueryEscape(shop),
	)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (s *Server) shopifyCallbackError(w http.ResponseWriter, r *http.Request, reason string) {
	redirectURL := fmt.Sprintf("%s/integrations/shopify?status=error&reason=%s",
		strings.TrimRight(s.cfg.AppBaseURL, "/"),
		url.QueryEscape(reason),
	)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// exchangeShopifyCode POSTs {client_id, client_secret, code} to the
// shop's /admin/oauth/access_token endpoint and parses the response.
func (s *Server) exchangeShopifyCode(ctx context.Context, shop, code string) (accessToken string, scopes []string, err error) {
	form := url.Values{}
	form.Set("client_id", s.cfg.ShopifyPartnerClientID)
	form.Set("client_secret", s.cfg.ShopifyPartnerClientSecret)
	form.Set("code", code)

	endpoint := fmt.Sprintf(shopifyOAuthTokenURLFmt, shop)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := s.shopifyHTTPClient()
	resp, err := client.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("post token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", nil, fmt.Errorf("shopify status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var parsed shopifyTokenExchangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", nil, fmt.Errorf("decode token response: %w", err)
	}
	if strings.TrimSpace(parsed.AccessToken) == "" {
		return "", nil, fmt.Errorf("shopify returned empty access_token")
	}
	scopeList := []string{}
	for _, sc := range strings.Split(parsed.Scope, ",") {
		sc = strings.TrimSpace(sc)
		if sc != "" {
			scopeList = append(scopeList, sc)
		}
	}
	return strings.TrimSpace(parsed.AccessToken), scopeList, nil
}

// shopifyHTTPClient returns the HTTP client used for token exchange.
// Overridable in tests via s.shopifyTestClient (server.go field).
func (s *Server) shopifyHTTPClient() *http.Client {
	if s.shopifyTestClient != nil {
		return s.shopifyTestClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func (s *Server) shopifyCallbackURL() string {
	return strings.TrimRight(s.cfg.AppBaseURL, "/") + "/v1/integrations/shopify/callback"
}

func (s *Server) shopifyConfigured() bool {
	return strings.TrimSpace(s.cfg.ShopifyPartnerClientID) != "" &&
		strings.TrimSpace(s.cfg.ShopifyPartnerClientSecret) != ""
}

// verifyShopifyCallbackHMAC recomputes the HMAC-SHA256 over the
// canonical query string (all query params except `hmac`, sorted by key,
// joined as k=v&… with raw values) using the app's client_secret. Per
// Shopify's documented OAuth callback verification.
func verifyShopifyCallbackHMAC(q url.Values, clientSecret string) bool {
	sent := strings.TrimSpace(q.Get("hmac"))
	if sent == "" {
		return false
	}
	keys := make([]string, 0, len(q))
	for k := range q {
		if k == "hmac" || k == "signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(q.Get(k))
	}
	mac := hmac.New(sha256.New, []byte(clientSecret))
	mac.Write([]byte(b.String()))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(expected)), []byte(strings.ToLower(sent))) == 1
}

func randomHexNonce(bytes int) (string, error) {
	if bytes <= 0 {
		bytes = 32
	}
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// redactNonce returns a short prefix for log lines so we can correlate
// without persisting the full single-use nonce.
func redactNonce(nonce string) string {
	if len(nonce) <= 8 {
		return "redacted"
	}
	return nonce[:8] + "…"
}

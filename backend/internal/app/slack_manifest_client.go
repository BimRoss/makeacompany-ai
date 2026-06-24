package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// SlackConfigTokens holds the access/refresh token pair used to authenticate
// against Slack's App Manifest API (apps.manifest.* + tooling.tokens.rotate).
// Mutex-protected because the reactive-refresh path swaps them under load.
//
// Boot: load both from env (SLACK_CONFIG_ACCESS_TOKEN / SLACK_CONFIG_REFRESH_TOKEN).
// On a successful tooling.tokens.rotate, the new pair replaces both via Set.
// A persist callback can be supplied to write the rotated pair back to a
// K8s Secret so the next pod restart picks up the latest pair; #418 slice 2
// wires the K8s implementation.
type SlackConfigTokens struct {
	mu      sync.RWMutex
	access  string
	refresh string
}

// NewSlackConfigTokens seeds the pair from env-level values.
func NewSlackConfigTokens(access, refresh string) *SlackConfigTokens {
	return &SlackConfigTokens{
		access:  strings.TrimSpace(access),
		refresh: strings.TrimSpace(refresh),
	}
}

// Access returns the current access token. Empty when tokens are unseeded.
func (t *SlackConfigTokens) Access() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.access
}

// Refresh returns the current refresh token.
func (t *SlackConfigTokens) Refresh() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.refresh
}

// Set replaces the pair atomically.
func (t *SlackConfigTokens) Set(access, refresh string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.access = strings.TrimSpace(access)
	t.refresh = strings.TrimSpace(refresh)
}

// PersistTokensFunc is called after a successful rotate so the new pair can
// be written somewhere durable (a K8s Secret in prod). Failure to persist is
// logged but does NOT roll back the in-memory swap — the in-memory state is
// authoritative for the running pod's lifetime; persistence is for the next
// boot.
type PersistTokensFunc func(ctx context.Context, access, refresh string) error

// SlackManifestClient calls Slack's App Manifest API.
//
// On any 200 response with `ok: false` AND `error: "invalid_auth"` /
// `not_authed` / `token_expired` / `token_revoked`, the client transparently
// rotates the config tokens via tooling.tokens.rotate and retries the
// original call once. Any other error (network, 4xx/5xx, parse) surfaces to
// the caller.
type SlackManifestClient struct {
	tokens   *SlackConfigTokens
	persist  PersistTokensFunc
	http     *http.Client
	baseURL  string // override for tests; defaults to https://slack.com
	log      *log.Logger
}

// NewSlackManifestClient builds a client. persist may be nil (no-op).
func NewSlackManifestClient(tokens *SlackConfigTokens, persist PersistTokensFunc, logger *log.Logger) *SlackManifestClient {
	if logger == nil {
		logger = log.Default()
	}
	return &SlackManifestClient{
		tokens:  tokens,
		persist: persist,
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: "https://slack.com",
		log:     logger,
	}
}

// Disabled reports whether the client lacks the credentials to operate. Mirror
// of the pattern used by ShopifyWriter / AgentToggleClient — callers can avoid
// constructing requests when the feature isn't configured.
func (c *SlackManifestClient) Disabled() bool {
	return c.tokens == nil || c.tokens.Access() == "" || c.tokens.Refresh() == ""
}

// ManifestCreateResponse mirrors the subset of apps.manifest.create we use.
// https://api.slack.com/methods/apps.manifest.create
type ManifestCreateResponse struct {
	OK                 bool   `json:"ok"`
	Error              string `json:"error,omitempty"`
	AppID              string `json:"app_id"`
	Credentials        ManifestCreateCredentials `json:"credentials"`
	OAuthAuthorizeURL  string `json:"oauth_authorize_url"`
}

type ManifestCreateCredentials struct {
	ClientID          string `json:"client_id"`
	ClientSecret      string `json:"client_secret"`
	VerificationToken string `json:"verification_token"`
	SigningSecret     string `json:"signing_secret"`
}

// CreateManifest calls apps.manifest.create with the given manifest JSON.
// The manifest must already have placeholders substituted (see
// slack-factory/manifests/personal-agent-baseline).
func (c *SlackManifestClient) CreateManifest(ctx context.Context, manifest json.RawMessage) (*ManifestCreateResponse, error) {
	if c.Disabled() {
		return nil, errors.New("slack manifest client disabled (config tokens unset)")
	}
	body := map[string]any{"manifest": json.RawMessage(manifest)}
	var resp ManifestCreateResponse
	if err := c.callJSONWithRefresh(ctx, "/api/apps.manifest.create", body, &resp); err != nil {
		return nil, err
	}
	if !resp.OK {
		return nil, fmt.Errorf("apps.manifest.create rejected: %s", resp.Error)
	}
	if strings.TrimSpace(resp.AppID) == "" {
		return nil, errors.New("apps.manifest.create returned empty app_id")
	}
	return &resp, nil
}

// ManifestUpdateResponse mirrors the subset of apps.manifest.update we use.
// Like apps.manifest.create, the update response echoes a fresh
// `oauth_authorize_url` that reflects the manifest's CURRENT bot scopes — so a
// scope change (e.g. adding groups:read for team mode) regenerates the install
// URL with the new `scope=` list. Callers persist this so the /me "Reinstall"
// button re-consents to the current scopes instead of the frozen create-time set.
// https://api.slack.com/methods/apps.manifest.update
type ManifestUpdateResponse struct {
	OK                bool   `json:"ok"`
	Error             string `json:"error,omitempty"`
	OAuthAuthorizeURL string `json:"oauth_authorize_url"`
	Errors            []struct {
		Code    string `json:"code,omitempty"`
		Message string `json:"message,omitempty"`
		Pointer string `json:"pointer,omitempty"`
	} `json:"errors,omitempty"`
}

// UpdateManifest calls apps.manifest.update on an existing app. Used by the
// "edit description" flow on /me and the manifest backfill to push the current
// manifest (name/description AND scopes) back to Slack so the bot listing — and
// the install/reinstall URL — stays in sync.
//
// Returns the response so callers can persist the refreshed oauth_authorize_url
// (which encodes the manifest's current scopes). When Slack omits the URL from
// its response, callers fall back to PersonalAgentInstallURLFromManifest.
func (c *SlackManifestClient) UpdateManifest(ctx context.Context, appID string, manifest json.RawMessage) (*ManifestUpdateResponse, error) {
	if c.Disabled() {
		return nil, errors.New("slack manifest client disabled (config tokens unset)")
	}
	if strings.TrimSpace(appID) == "" {
		return nil, errors.New("UpdateManifest: app_id required")
	}
	body := map[string]any{
		"app_id":   appID,
		"manifest": json.RawMessage(manifest),
	}
	var resp ManifestUpdateResponse
	if err := c.callJSONWithRefresh(ctx, "/api/apps.manifest.update", body, &resp); err != nil {
		return nil, err
	}
	if !resp.OK {
		if len(resp.Errors) > 0 {
			detail := make([]string, 0, len(resp.Errors))
			for _, e := range resp.Errors {
				detail = append(detail, fmt.Sprintf("%s@%s: %s", e.Code, e.Pointer, e.Message))
			}
			return nil, fmt.Errorf("apps.manifest.update rejected: %s (%s)", resp.Error, strings.Join(detail, "; "))
		}
		return nil, fmt.Errorf("apps.manifest.update rejected: %s", resp.Error)
	}
	return &resp, nil
}

// DeleteApp calls apps.manifest.delete to revoke the Slack app entirely.
// Used by the "delete agent" flow.
func (c *SlackManifestClient) DeleteApp(ctx context.Context, appID string) error {
	if c.Disabled() {
		return errors.New("slack manifest client disabled (config tokens unset)")
	}
	if strings.TrimSpace(appID) == "" {
		return errors.New("DeleteApp: app_id required")
	}
	body := map[string]any{"app_id": appID}
	var resp struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	if err := c.callJSONWithRefresh(ctx, "/api/apps.manifest.delete", body, &resp); err != nil {
		return err
	}
	if !resp.OK {
		return fmt.Errorf("apps.manifest.delete rejected: %s", resp.Error)
	}
	return nil
}

// rotateResponse mirrors the subset of tooling.tokens.rotate we use.
// https://api.slack.com/methods/tooling.tokens.rotate
type rotateResponse struct {
	OK           bool   `json:"ok"`
	Error        string `json:"error,omitempty"`
	Token        string `json:"token"`        // new access token (xoxe.xoxp-...)
	RefreshToken string `json:"refresh_token"` // new refresh token (xoxe-...)
	TeamID       string `json:"team_id,omitempty"`
	UserID       string `json:"user_id,omitempty"`
	ExpiresAt    int64  `json:"exp,omitempty"`
}

// rotate exchanges the current refresh token for a fresh pair. Updates
// in-memory state and (best-effort) calls the persist callback. Returns an
// error if Slack rejects the rotate — that's terminal: a stale refresh token
// requires operator intervention.
func (c *SlackManifestClient) rotate(ctx context.Context) error {
	currentRefresh := c.tokens.Refresh()
	if currentRefresh == "" {
		return errors.New("rotate: refresh token empty")
	}
	form := url.Values{"refresh_token": {currentRefresh}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/tooling.tokens.rotate", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpResp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("rotate: %w", err)
	}
	defer httpResp.Body.Close()
	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return fmt.Errorf("rotate read body: %w", err)
	}
	if httpResp.StatusCode != http.StatusOK {
		// Fail-open HTTP-gate guidance: log non-2xx with a clipped body so a silent
		// 4xx (e.g. wrong content-type) doesn't bite us during the rollout.
		c.log.Printf("tooling.tokens.rotate non-2xx: status=%d body=%s", httpResp.StatusCode, clip(string(respBody), 256))
		return fmt.Errorf("rotate status %d", httpResp.StatusCode)
	}
	var parsed rotateResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return fmt.Errorf("rotate parse: %w", err)
	}
	if !parsed.OK || parsed.Token == "" || parsed.RefreshToken == "" {
		return fmt.Errorf("rotate rejected: %s", parsed.Error)
	}
	c.tokens.Set(parsed.Token, parsed.RefreshToken)
	if c.persist != nil {
		if err := c.persist(ctx, parsed.Token, parsed.RefreshToken); err != nil {
			// Persistence failure is loud but non-fatal — in-memory state is
			// authoritative for this pod; the next boot will re-seed from env
			// if persistence failed.
			c.log.Printf("slack config token persist failed (in-memory updated, next-boot seed may be stale): %v", err)
		}
	}
	return nil
}

// callJSONWithRefresh POSTs a JSON body using the current access token. If
// Slack returns ok:false with an auth error, it rotates and retries once.
// Other errors surface unchanged.
func (c *SlackManifestClient) callJSONWithRefresh(ctx context.Context, path string, body any, out any) error {
	for attempt := 0; attempt < 2; attempt++ {
		retry, err := c.callJSON(ctx, path, body, out)
		if err == nil {
			return nil
		}
		if !retry || attempt == 1 {
			return err
		}
		c.log.Printf("slack manifest auth error, rotating + retrying: %v", err)
		if rerr := c.rotate(ctx); rerr != nil {
			return fmt.Errorf("rotate during retry: %w (original: %v)", rerr, err)
		}
	}
	return errors.New("unreachable")
}

// callJSON returns retryAfterAuth=true when the failure looks like a token
// problem worth one rotate-and-retry; otherwise false (error is terminal).
func (c *SlackManifestClient) callJSON(ctx context.Context, path string, body any, out any) (retryAfterAuth bool, err error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(buf))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+c.tokens.Access())
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	httpResp, err := c.http.Do(req)
	if err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	defer httpResp.Body.Close()
	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return false, fmt.Errorf("%s read body: %w", path, err)
	}
	if httpResp.StatusCode != http.StatusOK {
		c.log.Printf("slack %s non-2xx: status=%d body=%s", path, httpResp.StatusCode, clip(string(respBody), 256))
		return false, fmt.Errorf("%s status %d", path, httpResp.StatusCode)
	}
	// Parse twice: once into a thin probe for the error field, once into the
	// caller's out struct (kept independent so probing doesn't consume the body
	// or require out to embed ok/error fields).
	var probe struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(respBody, &probe); err != nil {
		return false, fmt.Errorf("%s probe parse: %w", path, err)
	}
	if !probe.OK && isAuthError(probe.Error) {
		return true, fmt.Errorf("%s auth error: %s", path, probe.Error)
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return false, fmt.Errorf("%s parse: %w", path, err)
	}
	return false, nil
}

// isAuthError returns true for the Slack error strings that indicate a stale
// access token (rotate may help).
func isAuthError(s string) bool {
	switch strings.TrimSpace(s) {
	case "invalid_auth", "not_authed", "token_expired", "token_revoked":
		return true
	}
	return false
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

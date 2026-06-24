package app

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// newTestManifestClient builds a SlackManifestClient backed by an httptest
// server. The handlerFn mutates a counter so tests can assert call sequences.
func newTestManifestClient(t *testing.T, handler http.HandlerFunc, access, refresh string) (*SlackManifestClient, *httptest.Server, *[]string) {
	t.Helper()
	calls := &[]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls = append(*calls, r.URL.Path)
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	c := NewSlackManifestClient(
		NewSlackConfigTokens(access, refresh),
		nil,
		log.New(io.Discard, "", 0),
	)
	c.baseURL = srv.URL
	return c, srv, calls
}

func TestSlackManifestClient_CreateManifest_Success(t *testing.T) {
	c, _, calls := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/apps.manifest.create" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			t.Errorf("missing Bearer auth, got %q", auth)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     true,
			"app_id": "A0NEWAPP",
			"credentials": map[string]string{
				"client_id":     "111.222",
				"client_secret": "csecret",
				"signing_secret": "ssecret",
			},
			"oauth_authorize_url": "https://slack.com/oauth/v2/authorize?client_id=111.222",
		})
	}, "xoxe.xoxp-access", "xoxe-refresh")

	resp, err := c.CreateManifest(context.Background(), json.RawMessage(`{"display_information":{"name":"Test"}}`))
	if err != nil {
		t.Fatalf("CreateManifest: %v", err)
	}
	if resp.AppID != "A0NEWAPP" {
		t.Errorf("AppID = %q, want A0NEWAPP", resp.AppID)
	}
	if resp.Credentials.SigningSecret != "ssecret" {
		t.Errorf("SigningSecret = %q, want ssecret", resp.Credentials.SigningSecret)
	}
	if len(*calls) != 1 || (*calls)[0] != "/api/apps.manifest.create" {
		t.Errorf("expected one create call, got %v", *calls)
	}
}

func TestSlackManifestClient_CreateManifest_RotatesOnInvalidAuth(t *testing.T) {
	var createCount int32
	c, _, calls := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/apps.manifest.create":
			n := atomic.AddInt32(&createCount, 1)
			if n == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "token_expired"})
				return
			}
			// Second call should carry the rotated bearer.
			auth := r.Header.Get("Authorization")
			if auth != "Bearer xoxe.xoxp-NEW" {
				t.Errorf("expected rotated bearer on retry, got %q", auth)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"app_id": "A0AFTER",
				"credentials": map[string]string{"signing_secret": "s2"},
			})
		case "/api/tooling.tokens.rotate":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":            true,
				"token":         "xoxe.xoxp-NEW",
				"refresh_token": "xoxe-NEW",
			})
		default:
			http.NotFound(w, r)
		}
	}, "xoxe.xoxp-OLD", "xoxe-OLD")

	resp, err := c.CreateManifest(context.Background(), json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("CreateManifest after rotate: %v", err)
	}
	if resp.AppID != "A0AFTER" {
		t.Errorf("AppID = %q, want A0AFTER", resp.AppID)
	}
	if c.tokens.Access() != "xoxe.xoxp-NEW" {
		t.Errorf("in-memory access token not updated: %q", c.tokens.Access())
	}
	if c.tokens.Refresh() != "xoxe-NEW" {
		t.Errorf("in-memory refresh token not updated: %q", c.tokens.Refresh())
	}
	wantSeq := []string{
		"/api/apps.manifest.create",
		"/api/tooling.tokens.rotate",
		"/api/apps.manifest.create",
	}
	if !sliceEqual(*calls, wantSeq) {
		t.Errorf("call sequence = %v, want %v", *calls, wantSeq)
	}
}

func TestSlackManifestClient_CreateManifest_RotateFailureIsTerminal(t *testing.T) {
	c, _, _ := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/apps.manifest.create":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid_auth"})
		case "/api/tooling.tokens.rotate":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid_refresh_token"})
		}
	}, "old", "old-refresh")

	_, err := c.CreateManifest(context.Background(), json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected terminal error when rotate also fails")
	}
	if !strings.Contains(err.Error(), "rotate during retry") {
		t.Errorf("error doesn't mention rotate failure: %v", err)
	}
}

func TestSlackManifestClient_CreateManifest_NonAuthErrorDoesNotRotate(t *testing.T) {
	rotateCalled := false
	c, _, _ := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/apps.manifest.create":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid_manifest"})
		case "/api/tooling.tokens.rotate":
			rotateCalled = true
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "token": "n", "refresh_token": "n"})
		}
	}, "a", "r")

	_, err := c.CreateManifest(context.Background(), json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error for invalid_manifest")
	}
	if rotateCalled {
		t.Fatal("rotate should NOT be called for non-auth errors")
	}
}

func TestSlackManifestClient_PersistTokensCallbackInvokedOnRotate(t *testing.T) {
	var persisted struct {
		access  string
		refresh string
		count   int
	}
	persist := func(_ context.Context, a, r string) error {
		persisted.access = a
		persisted.refresh = r
		persisted.count++
		return nil
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/apps.manifest.create":
			if r.Header.Get("Authorization") == "Bearer old-access" {
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "token_expired"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "app_id": "A1"})
		case "/api/tooling.tokens.rotate":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":            true,
				"token":         "new-access",
				"refresh_token": "new-refresh",
			})
		}
	}))
	t.Cleanup(srv.Close)

	c := NewSlackManifestClient(NewSlackConfigTokens("old-access", "old-refresh"), persist, log.New(io.Discard, "", 0))
	c.baseURL = srv.URL

	if _, err := c.CreateManifest(context.Background(), json.RawMessage(`{}`)); err != nil {
		t.Fatalf("CreateManifest: %v", err)
	}
	if persisted.count != 1 {
		t.Errorf("persist callback called %d times, want 1", persisted.count)
	}
	if persisted.access != "new-access" || persisted.refresh != "new-refresh" {
		t.Errorf("persist got (%q, %q), want (new-access, new-refresh)", persisted.access, persisted.refresh)
	}
}

// TestSlackManifestClient_UpdateManifest_ReturnsAuthorizeURL locks the #653 fix:
// apps.manifest.update echoes a fresh oauth_authorize_url (same shape as create)
// reflecting the manifest's current scopes, and UpdateManifest must surface it so
// callers can persist the refreshed install URL.
func TestSlackManifestClient_UpdateManifest_ReturnsAuthorizeURL(t *testing.T) {
	const wantURL = "https://slack.com/oauth/v2/authorize?client_id=111.222&scope=groups%3Aread%2Cchat%3Awrite"
	c, _, calls := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/apps.manifest.update" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":                  true,
			"app_id":              "A0APP",
			"oauth_authorize_url": wantURL,
		})
	}, "xoxe.xoxp-access", "xoxe-refresh")

	resp, err := c.UpdateManifest(context.Background(), "A0APP", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("UpdateManifest: %v", err)
	}
	if resp.OAuthAuthorizeURL != wantURL {
		t.Errorf("OAuthAuthorizeURL = %q, want %q", resp.OAuthAuthorizeURL, wantURL)
	}
	if len(*calls) != 1 || (*calls)[0] != "/api/apps.manifest.update" {
		t.Errorf("expected one update call, got %v", *calls)
	}
}

func TestSlackManifestClient_UpdateManifest_RejectedSurfacesError(t *testing.T) {
	c, _, _ := newTestManifestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid_manifest",
			"errors": []map[string]any{
				{"code": "invalid_scopes", "pointer": "/oauth_config/scopes", "message": "bad scope"},
			},
		})
	}, "a", "r")

	resp, err := c.UpdateManifest(context.Background(), "A0APP", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error for rejected update")
	}
	if resp != nil {
		t.Errorf("expected nil response on rejection, got %+v", resp)
	}
	if !strings.Contains(err.Error(), "invalid_scopes") {
		t.Errorf("error should carry the detail, got %v", err)
	}
}

func TestSlackManifestClient_Disabled(t *testing.T) {
	c := NewSlackManifestClient(NewSlackConfigTokens("", ""), nil, log.New(io.Discard, "", 0))
	if !c.Disabled() {
		t.Fatal("expected Disabled() with empty tokens")
	}
	_, err := c.CreateManifest(context.Background(), json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error when disabled")
	}
}

func sliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

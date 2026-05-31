package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// revoke must POST application/x-www-form-urlencoded with token=… per
// RFC 7009 + Google docs. This is the wire shape gws-mcp-token-sidecar
// relies on for the same operation; mismatch surfaces as silent leak.
func TestRevokeGoogleRefreshToken_postsTokenFormEncoded(t *testing.T) {
	var gotMethod, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	prev := googleRevokeEndpoint
	googleRevokeEndpoint = srv.URL
	t.Cleanup(func() { googleRevokeEndpoint = prev })

	if err := revokeGoogleRefreshToken(context.Background(), "rt_abc123"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if !strings.HasPrefix(gotContentType, "application/x-www-form-urlencoded") {
		t.Errorf("content-type = %s, want application/x-www-form-urlencoded", gotContentType)
	}
	if gotBody != "token=rt_abc123" {
		t.Errorf("body = %q, want token=rt_abc123", gotBody)
	}
}

func TestRevokeGoogleRefreshToken_nonSuccessReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)

	prev := googleRevokeEndpoint
	googleRevokeEndpoint = srv.URL
	t.Cleanup(func() { googleRevokeEndpoint = prev })

	if err := revokeGoogleRefreshToken(context.Background(), "rt"); err == nil {
		t.Fatalf("revoke: want error, got nil")
	}
}

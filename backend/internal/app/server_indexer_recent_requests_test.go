package app

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// Verify that an unreachable / unconfigured indexer surfaces as 200 OK with a
// "degraded" body instead of 502, so a known-absent dependency does not burn
// the backend 5xx error budget on every admin poll.
func TestHandleIndexerRecentRequestsDegradedNotBadGateway(t *testing.T) {
	t.Setenv("HEALTH_TWITTER_INDEXER_URL", "")

	s := &Server{
		log:    log.New(os.Stderr, "", 0),
		health: newHealthChecker(nil, ""),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/internal/indexer-recent-requests?limit=100&offset=0", nil)
	rec := httptest.NewRecorder()

	s.handleIndexerRecentRequests(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}

	var body struct {
		Status   string `json:"status"`
		Error    string `json:"error"`
		Requests []any  `json:"requests"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "degraded" {
		t.Fatalf("status field: got %q, want \"degraded\"", body.Status)
	}
	if body.Error == "" {
		t.Fatalf("error field is empty; want a reason message")
	}
	if body.Requests == nil {
		t.Fatalf("requests field is nil; want []")
	}
}

// Verify that the /api/internal/* paths get their own metric labels instead of
// falling into /other (which would also trip the "unrouted 5xx" logger).
func TestNormalizeMetricRouteApiInternalPaths(t *testing.T) {
	cases := map[string]string{
		"/api/internal/cookie-health":            "/api/internal/cookie-health",
		"/api/internal/indexer-recent-requests":  "/api/internal/indexer-recent-requests",
	}
	for in, want := range cases {
		if got := normalizeMetricRoute(in); got != want {
			t.Errorf("normalizeMetricRoute(%q) = %q, want %q", in, got, want)
		}
	}
}

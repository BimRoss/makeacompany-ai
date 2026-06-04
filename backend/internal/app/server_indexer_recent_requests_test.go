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

// Verify that labelRoute reports the ServeMux pattern that matched a request,
// not a hand-maintained switch. The previous switch-based normalizer drifted
// out of sync with the route table (#38 B1 — top-routes panel collapsed real
// endpoints into /other), so this test exercises a representative slice of
// the registered patterns plus the unrouted fallback.
func TestServerLabelRouteMatchesMuxPattern(t *testing.T) {
	mux := http.NewServeMux()
	noop := func(http.ResponseWriter, *http.Request) {}
	mux.HandleFunc("/livez", noop)
	mux.HandleFunc("/api/internal/cookie-health", noop)
	mux.HandleFunc("/api/internal/indexer-recent-requests", noop)
	mux.HandleFunc("/v1/billing/checkout", noop)
	mux.HandleFunc("/v1/admin/testimonials", noop)
	mux.HandleFunc("/v1/admin/testimonials/", noop) // collection + child paths
	mux.HandleFunc("/v1/admin/ga4-summary", noop)
	mux.HandleFunc("GET /v1/admin/agents/status", noop)
	mux.HandleFunc("POST /v1/admin/agents/{name}/toggle", noop)

	s := &Server{mux: mux}

	cases := []struct {
		method, path, want string
	}{
		{"GET", "/livez", "/livez"},
		{"GET", "/api/internal/cookie-health", "/api/internal/cookie-health"},
		{"GET", "/api/internal/indexer-recent-requests", "/api/internal/indexer-recent-requests"},
		{"POST", "/v1/billing/checkout", "/v1/billing/checkout"},
		{"GET", "/v1/admin/testimonials", "/v1/admin/testimonials"},
		{"GET", "/v1/admin/testimonials/abc123", "/v1/admin/testimonials/"},
		{"GET", "/v1/admin/ga4-summary", "/v1/admin/ga4-summary"},
		{"GET", "/v1/admin/agents/status", "/v1/admin/agents/status"},
		{"POST", "/v1/admin/agents/ross/toggle", "/v1/admin/agents/{name}/toggle"},
		// Unmatched paths bucket so cardinality stays bounded.
		{"GET", "/v1/totally-unrouted-thing", "/v1/other"},
		{"GET", "/random-bot-scan", "/other"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if got := s.labelRoute(req); got != tc.want {
			t.Errorf("labelRoute(%s %s) = %q, want %q", tc.method, tc.path, got, tc.want)
		}
	}
}

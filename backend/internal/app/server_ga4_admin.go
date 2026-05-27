package app

// GA4 summary endpoint for the /admin dashboard.
//
// Reads activeUsers + sessions for the last 7 days from Google Analytics 4
// property GA4_PROPERTY_ID via the Analytics Data API. Auth uses Application
// Default Credentials, so GOOGLE_APPLICATION_CREDENTIALS must point to a
// service-account key whose principal is bound as Viewer on the GA4 property
// (use the v1alpha accessBindings POST — the GA4 UI hard-blocks SA emails).
//
// Prod TODO (2026-05-27): the rancher-admin makeacompany Helm chart needs a
// Secret carrying the SA key and the backend Deployment needs:
//   env:
//     - name: GA4_PROPERTY_ID
//       value: "527260023"
//     - name: GOOGLE_APPLICATION_CREDENTIALS
//       value: /var/run/secrets/ga4/key.json
//   volumeMounts:
//     - { name: ga4-sa, mountPath: /var/run/secrets/ga4, readOnly: true }
// Until that lands, the endpoint returns 503 in prod and the panel renders
// its empty state.

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"google.golang.org/api/analyticsdata/v1beta"
)

const ga4SummaryFetchTimeout = 10 * time.Second

// handleAdminGA4Summary returns the last-7d activeUsers + sessions for the
// configured GA4 property. Live call every time — no Redis snapshot yet (panel
// is read-mostly and the GA Data API is fast; revisit if we add more metrics).
func (s *Server) handleAdminGA4Summary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}

	propertyID := strings.TrimSpace(s.cfg.GA4PropertyID)
	if propertyID == "" {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"status": "disabled",
			"error":  "GA4_PROPERTY_ID is not set",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), ga4SummaryFetchTimeout)
	defer cancel()

	svc, err := analyticsdata.NewService(ctx)
	if err != nil {
		s.log.Printf("admin ga4-summary: NewService: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"status": "degraded",
			"error":  "google analytics data client init failed",
		})
		return
	}

	req := &analyticsdata.RunReportRequest{
		DateRanges: []*analyticsdata.DateRange{{StartDate: "7daysAgo", EndDate: "yesterday"}},
		Metrics: []*analyticsdata.Metric{
			{Name: "activeUsers"},
			{Name: "sessions"},
		},
	}
	resp, err := svc.Properties.RunReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: runReport: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"status": "degraded",
			"error":  "ga4 runReport failed",
		})
		return
	}

	activeUsers, sessions := ga4SummaryMetricsFromReport(resp)
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"propertyId":  propertyID,
		"startDate":   "7daysAgo",
		"endDate":     "yesterday",
		"activeUsers": activeUsers,
		"sessions":    sessions,
		"fetchedAt":   time.Now().UTC().Format(time.RFC3339),
	})
}

// ga4SummaryMetricsFromReport extracts activeUsers + sessions from a single-row
// report. Returns zeros if the report shape is unexpected (GA4 returns no rows
// when there's zero traffic in the window, which is valid for a new property).
func ga4SummaryMetricsFromReport(resp *analyticsdata.RunReportResponse) (activeUsers, sessions int64) {
	if resp == nil || len(resp.Rows) == 0 {
		return 0, 0
	}
	row := resp.Rows[0]
	if len(row.MetricValues) >= 1 {
		activeUsers = parseGA4Int(row.MetricValues[0].Value)
	}
	if len(row.MetricValues) >= 2 {
		sessions = parseGA4Int(row.MetricValues[1].Value)
	}
	return activeUsers, sessions
}

func parseGA4Int(s string) int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return 0
	}
	return n
}

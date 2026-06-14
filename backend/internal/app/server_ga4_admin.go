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

const (
	ga4SummaryFetchTimeout = 10 * time.Second
	ga4TopPagesRowLimit    = 10
	ga4SourcesRowLimit     = 6
	ga4CountriesRowLimit   = 6
)

type ga4TopPage struct {
	Path  string `json:"path"`
	Views int64  `json:"views"`
	Users int64  `json:"users"`
}

type ga4SourceRow struct {
	Channel  string `json:"channel"`
	Sessions int64  `json:"sessions"`
	Users    int64  `json:"users"`
}

type ga4CountryRow struct {
	Country string `json:"country"`
	Users   int64  `json:"users"`
}

type ga4DailyPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

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

	// Best-effort dimensional breakdowns. Failures log and return empties so the
	// core counts still render even if one breakdown breaks.
	topPages := ga4FetchTopPages(ctx, s, svc, propertyID)
	sources := ga4FetchSources(ctx, s, svc, propertyID)
	countries := ga4FetchCountries(ctx, s, svc, propertyID)
	realtime := ga4FetchRealtime(ctx, s, svc, propertyID)
	activeUsersDaily, sessionsDaily := ga4FetchDaily(ctx, s, svc, propertyID)

	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"propertyId":       propertyID,
		"startDate":        "7daysAgo",
		"endDate":          "yesterday",
		"activeUsers":      activeUsers,
		"sessions":         sessions,
		"activeUsersDaily": activeUsersDaily,
		"sessionsDaily":    sessionsDaily,
		"topPages":         topPages,
		"sources":          sources,
		"countries":        countries,
		"realtimeUsers":    realtime,
		"fetchedAt":        time.Now().UTC().Format(time.RFC3339),
	})
}

func ga4FetchTopPages(ctx context.Context, s *Server, svc *analyticsdata.Service, propertyID string) []ga4TopPage {
	req := &analyticsdata.RunReportRequest{
		DateRanges: []*analyticsdata.DateRange{{StartDate: "7daysAgo", EndDate: "yesterday"}},
		Dimensions: []*analyticsdata.Dimension{{Name: "pagePath"}},
		Metrics: []*analyticsdata.Metric{
			{Name: "screenPageViews"},
			{Name: "activeUsers"},
		},
		OrderBys: []*analyticsdata.OrderBy{{
			Desc:   true,
			Metric: &analyticsdata.MetricOrderBy{MetricName: "screenPageViews"},
		}},
		Limit: ga4TopPagesRowLimit,
	}
	resp, err := svc.Properties.RunReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: topPages: %v", err)
		return []ga4TopPage{}
	}
	out := make([]ga4TopPage, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		path := ""
		if len(row.DimensionValues) > 0 {
			path = row.DimensionValues[0].Value
		}
		var views, users int64
		if len(row.MetricValues) >= 1 {
			views = parseGA4Int(row.MetricValues[0].Value)
		}
		if len(row.MetricValues) >= 2 {
			users = parseGA4Int(row.MetricValues[1].Value)
		}
		out = append(out, ga4TopPage{Path: path, Views: views, Users: users})
	}
	return out
}

func ga4FetchSources(ctx context.Context, s *Server, svc *analyticsdata.Service, propertyID string) []ga4SourceRow {
	req := &analyticsdata.RunReportRequest{
		DateRanges: []*analyticsdata.DateRange{{StartDate: "7daysAgo", EndDate: "yesterday"}},
		Dimensions: []*analyticsdata.Dimension{{Name: "sessionDefaultChannelGroup"}},
		Metrics: []*analyticsdata.Metric{
			{Name: "sessions"},
			{Name: "activeUsers"},
		},
		OrderBys: []*analyticsdata.OrderBy{{
			Desc:   true,
			Metric: &analyticsdata.MetricOrderBy{MetricName: "sessions"},
		}},
		Limit: ga4SourcesRowLimit,
	}
	resp, err := svc.Properties.RunReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: sources: %v", err)
		return []ga4SourceRow{}
	}
	out := make([]ga4SourceRow, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		ch := ""
		if len(row.DimensionValues) > 0 {
			ch = row.DimensionValues[0].Value
		}
		var sessions, users int64
		if len(row.MetricValues) >= 1 {
			sessions = parseGA4Int(row.MetricValues[0].Value)
		}
		if len(row.MetricValues) >= 2 {
			users = parseGA4Int(row.MetricValues[1].Value)
		}
		out = append(out, ga4SourceRow{Channel: ch, Sessions: sessions, Users: users})
	}
	return out
}

func ga4FetchCountries(ctx context.Context, s *Server, svc *analyticsdata.Service, propertyID string) []ga4CountryRow {
	req := &analyticsdata.RunReportRequest{
		DateRanges: []*analyticsdata.DateRange{{StartDate: "7daysAgo", EndDate: "yesterday"}},
		Dimensions: []*analyticsdata.Dimension{{Name: "country"}},
		Metrics:    []*analyticsdata.Metric{{Name: "activeUsers"}},
		OrderBys: []*analyticsdata.OrderBy{{
			Desc:   true,
			Metric: &analyticsdata.MetricOrderBy{MetricName: "activeUsers"},
		}},
		Limit: ga4CountriesRowLimit,
	}
	resp, err := svc.Properties.RunReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: countries: %v", err)
		return []ga4CountryRow{}
	}
	out := make([]ga4CountryRow, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		country := ""
		if len(row.DimensionValues) > 0 {
			country = row.DimensionValues[0].Value
		}
		var users int64
		if len(row.MetricValues) >= 1 {
			users = parseGA4Int(row.MetricValues[0].Value)
		}
		out = append(out, ga4CountryRow{Country: country, Users: users})
	}
	return out
}

// ga4FetchDaily returns the activeUsers and sessions series over the 7d window,
// one point per day, ordered ascending by date (YYYYMMDD). Best-effort: a
// failure returns empty slices so the growth tiles still render their totals.
func ga4FetchDaily(ctx context.Context, s *Server, svc *analyticsdata.Service, propertyID string) (activeUsers, sessions []ga4DailyPoint) {
	req := &analyticsdata.RunReportRequest{
		DateRanges: []*analyticsdata.DateRange{{StartDate: "7daysAgo", EndDate: "yesterday"}},
		Dimensions: []*analyticsdata.Dimension{{Name: "date"}},
		Metrics: []*analyticsdata.Metric{
			{Name: "activeUsers"},
			{Name: "sessions"},
		},
		OrderBys: []*analyticsdata.OrderBy{{
			Dimension: &analyticsdata.DimensionOrderBy{DimensionName: "date"},
		}},
	}
	resp, err := svc.Properties.RunReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: daily: %v", err)
		return []ga4DailyPoint{}, []ga4DailyPoint{}
	}
	activeUsers = make([]ga4DailyPoint, 0, len(resp.Rows))
	sessions = make([]ga4DailyPoint, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		date := ""
		if len(row.DimensionValues) > 0 {
			date = row.DimensionValues[0].Value
		}
		var au, se int64
		if len(row.MetricValues) >= 1 {
			au = parseGA4Int(row.MetricValues[0].Value)
		}
		if len(row.MetricValues) >= 2 {
			se = parseGA4Int(row.MetricValues[1].Value)
		}
		activeUsers = append(activeUsers, ga4DailyPoint{Date: date, Value: au})
		sessions = append(sessions, ga4DailyPoint{Date: date, Value: se})
	}
	return activeUsers, sessions
}

// ga4FetchRealtime returns active users in the last 30 minutes via the Realtime
// Reporting API. Returns -1 if the call fails so the frontend can hide the tile.
func ga4FetchRealtime(ctx context.Context, s *Server, svc *analyticsdata.Service, propertyID string) int64 {
	req := &analyticsdata.RunRealtimeReportRequest{
		Metrics: []*analyticsdata.Metric{{Name: "activeUsers"}},
	}
	resp, err := svc.Properties.RunRealtimeReport("properties/"+propertyID, req).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin ga4-summary: realtime: %v", err)
		return -1
	}
	if resp == nil || len(resp.Rows) == 0 || len(resp.Rows[0].MetricValues) == 0 {
		return 0
	}
	return parseGA4Int(resp.Rows[0].MetricValues[0].Value)
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

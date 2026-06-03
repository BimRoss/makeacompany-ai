package app

// Search Console summary endpoint for the /admin dashboard.
//
// Reads impressions, clicks, CTR, average position, and the top queries from
// Google Search Console via the Searchanalytics API for the configured site
// (GSC_SITE_URL, e.g. "sc-domain:makeacompany.ai"). Reuses the same GA4
// service-account ADC — the ga4-reader principal is also granted siteOwner on
// the GSC property, so no additional secret is required.
//
// GSC's reporting pipeline has a ~2-day finalization lag, so the window is
// 9daysAgo → 2daysAgo (last 7 fully-finalized days). The frontend surfaces
// that as an "as of" caption.

import (
	"context"
	"net/http"
	"strings"
	"time"

	"google.golang.org/api/webmasters/v3"
)

const (
	gscSummaryFetchTimeout = 10 * time.Second
	gscSummaryTopQueryRows = 5
	gscSummaryLagDays      = 2
	gscSummaryWindowDays   = 7
)

type gscTopQuery struct {
	Query       string  `json:"query"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	CTR         float64 `json:"ctr"`
	Position    float64 `json:"position"`
}

func (s *Server) handleAdminGSCSummary(w http.ResponseWriter, r *http.Request) {
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

	siteURL := strings.TrimSpace(s.cfg.GSCSiteURL)
	if siteURL == "" {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"status": "disabled",
			"error":  "GSC_SITE_URL is not set",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), gscSummaryFetchTimeout)
	defer cancel()

	svc, err := webmasters.NewService(ctx)
	if err != nil {
		s.log.Printf("admin gsc-summary: NewService: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"status": "degraded",
			"error":  "google search console client init failed",
		})
		return
	}

	endDate := time.Now().UTC().AddDate(0, 0, -gscSummaryLagDays).Format("2006-01-02")
	startDate := time.Now().UTC().AddDate(0, 0, -(gscSummaryLagDays + gscSummaryWindowDays - 1)).Format("2006-01-02")

	totals, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate: startDate,
		EndDate:   endDate,
	}).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin gsc-summary: totals query: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"status": "degraded",
			"error":  "gsc totals query failed",
		})
		return
	}

	queriesResp, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"query"},
		RowLimit:   gscSummaryTopQueryRows,
	}).Context(ctx).Do()
	if err != nil {
		s.log.Printf("admin gsc-summary: top-queries query: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"status": "degraded",
			"error":  "gsc top-queries query failed",
		})
		return
	}

	impressions, clicks, ctr, position := gscSummaryTotals(totals)
	topQueries := gscSummaryTopQueries(queriesResp)

	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"siteUrl":     siteURL,
		"startDate":   startDate,
		"endDate":     endDate,
		"impressions": impressions,
		"clicks":      clicks,
		"ctr":         ctr,
		"position":    position,
		"topQueries":  topQueries,
		"fetchedAt":   time.Now().UTC().Format(time.RFC3339),
	})
}

func gscSummaryTotals(resp *webmasters.SearchAnalyticsQueryResponse) (impressions, clicks int64, ctr, position float64) {
	if resp == nil || len(resp.Rows) == 0 {
		return 0, 0, 0, 0
	}
	row := resp.Rows[0]
	return int64(row.Impressions), int64(row.Clicks), row.Ctr, row.Position
}

func gscSummaryTopQueries(resp *webmasters.SearchAnalyticsQueryResponse) []gscTopQuery {
	if resp == nil {
		return []gscTopQuery{}
	}
	out := make([]gscTopQuery, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		q := ""
		if len(row.Keys) > 0 {
			q = row.Keys[0]
		}
		out = append(out, gscTopQuery{
			Query:       q,
			Impressions: int64(row.Impressions),
			Clicks:      int64(row.Clicks),
			CTR:         row.Ctr,
			Position:    row.Position,
		})
	}
	return out
}

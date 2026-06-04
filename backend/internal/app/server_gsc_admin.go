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
	gscSummaryFetchTimeout    = 10 * time.Second
	gscSummaryTopQueryRows    = 5
	gscSummaryTopPageRows     = 10
	gscSummaryHostScanRows    = 50
	gscSummaryTopHostRows     = 8
	gscSummaryLagDays         = 2
	gscSummaryWindowDays      = 7
	gscTimeseriesWindowDays   = 28
	gscTimeseriesMaxRows      = 32
)

type gscTopQuery struct {
	Query       string  `json:"query"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	CTR         float64 `json:"ctr"`
	Position    float64 `json:"position"`
}

type gscTopPage struct {
	Page        string  `json:"page"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	CTR         float64 `json:"ctr"`
	Position    float64 `json:"position"`
}

type gscDeviceRow struct {
	Device      string  `json:"device"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	CTR         float64 `json:"ctr"`
	Position    float64 `json:"position"`
}

type gscHostRow struct {
	Host        string  `json:"host"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
}

type gscDailyPoint struct {
	Date        string  `json:"date"`
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

	// 28-day daily breakdown for the /admin Search time-series panels
	// (BimRoss/makeacompany-ai#260). Best-effort: a failure here returns the
	// rest of the payload with an empty timeseries rather than a 502.
	tsEnd := endDate
	tsStart := time.Now().UTC().AddDate(0, 0, -(gscSummaryLagDays + gscTimeseriesWindowDays - 1)).Format("2006-01-02")
	dailyResp, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate:  tsStart,
		EndDate:    tsEnd,
		Dimensions: []string{"date"},
		RowLimit:   gscTimeseriesMaxRows,
	}).Context(ctx).Do()
	var daily []gscDailyPoint
	if err != nil {
		s.log.Printf("admin gsc-summary: daily timeseries query: %v", err)
	} else {
		daily = gscSummaryDaily(dailyResp)
	}

	// Top pages over the 7d window (BimRoss/makeacompany-ai#TBD). Best-effort.
	var topPages []gscTopPage
	if pagesResp, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"page"},
		RowLimit:   gscSummaryTopPageRows,
	}).Context(ctx).Do(); err != nil {
		s.log.Printf("admin gsc-summary: top-pages query: %v", err)
	} else {
		topPages = gscSummaryTopPages(pagesResp)
	}

	// Device split over the 7d window.
	var deviceSplit []gscDeviceRow
	if devicesResp, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"device"},
		RowLimit:   8,
	}).Context(ctx).Do(); err != nil {
		s.log.Printf("admin gsc-summary: device-split query: %v", err)
	} else {
		deviceSplit = gscSummaryDevices(devicesResp)
	}

	// Per-host breakdown: pull a fatter page slice and group by hostname so
	// persona subdomains under sc-domain:makeacompany.ai show up separately.
	var topHosts []gscHostRow
	if hostResp, err := svc.Searchanalytics.Query(siteURL, &webmasters.SearchAnalyticsQueryRequest{
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"page"},
		RowLimit:   gscSummaryHostScanRows,
	}).Context(ctx).Do(); err != nil {
		s.log.Printf("admin gsc-summary: hosts scan query: %v", err)
	} else {
		topHosts = gscSummaryTopHosts(hostResp, gscSummaryTopHostRows)
	}

	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"status":          "ok",
		"siteUrl":         siteURL,
		"startDate":       startDate,
		"endDate":         endDate,
		"impressions":     impressions,
		"clicks":          clicks,
		"ctr":             ctr,
		"position":        position,
		"topQueries":      topQueries,
		"topPages":        topPages,
		"deviceSplit":     deviceSplit,
		"topHosts":        topHosts,
		"daily":           daily,
		"dailyStartDate":  tsStart,
		"dailyEndDate":    tsEnd,
		"fetchedAt":       time.Now().UTC().Format(time.RFC3339),
	})
}

func gscSummaryTotals(resp *webmasters.SearchAnalyticsQueryResponse) (impressions, clicks int64, ctr, position float64) {
	if resp == nil || len(resp.Rows) == 0 {
		return 0, 0, 0, 0
	}
	row := resp.Rows[0]
	return int64(row.Impressions), int64(row.Clicks), row.Ctr, row.Position
}

func gscSummaryDaily(resp *webmasters.SearchAnalyticsQueryResponse) []gscDailyPoint {
	if resp == nil {
		return []gscDailyPoint{}
	}
	out := make([]gscDailyPoint, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		date := ""
		if len(row.Keys) > 0 {
			date = row.Keys[0]
		}
		out = append(out, gscDailyPoint{
			Date:        date,
			Impressions: int64(row.Impressions),
			Clicks:      int64(row.Clicks),
			CTR:         row.Ctr,
			Position:    row.Position,
		})
	}
	return out
}

func gscSummaryTopPages(resp *webmasters.SearchAnalyticsQueryResponse) []gscTopPage {
	if resp == nil {
		return []gscTopPage{}
	}
	out := make([]gscTopPage, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		page := ""
		if len(row.Keys) > 0 {
			page = row.Keys[0]
		}
		out = append(out, gscTopPage{
			Page:        page,
			Impressions: int64(row.Impressions),
			Clicks:      int64(row.Clicks),
			CTR:         row.Ctr,
			Position:    row.Position,
		})
	}
	return out
}

func gscSummaryDevices(resp *webmasters.SearchAnalyticsQueryResponse) []gscDeviceRow {
	if resp == nil {
		return []gscDeviceRow{}
	}
	out := make([]gscDeviceRow, 0, len(resp.Rows))
	for _, row := range resp.Rows {
		device := ""
		if len(row.Keys) > 0 {
			device = strings.ToLower(row.Keys[0])
		}
		out = append(out, gscDeviceRow{
			Device:      device,
			Impressions: int64(row.Impressions),
			Clicks:      int64(row.Clicks),
			CTR:         row.Ctr,
			Position:    row.Position,
		})
	}
	return out
}

// gscSummaryTopHosts buckets page rows by hostname (sc-domain properties return
// fully-qualified URLs across subdomains) and returns the top N by impressions.
func gscSummaryTopHosts(resp *webmasters.SearchAnalyticsQueryResponse, limit int) []gscHostRow {
	if resp == nil || limit <= 0 {
		return []gscHostRow{}
	}
	type acc struct {
		impressions int64
		clicks      int64
	}
	byHost := map[string]*acc{}
	for _, row := range resp.Rows {
		if len(row.Keys) == 0 {
			continue
		}
		host := hostFromGSCPage(row.Keys[0])
		if host == "" {
			continue
		}
		a, ok := byHost[host]
		if !ok {
			a = &acc{}
			byHost[host] = a
		}
		a.impressions += int64(row.Impressions)
		a.clicks += int64(row.Clicks)
	}
	out := make([]gscHostRow, 0, len(byHost))
	for host, a := range byHost {
		out = append(out, gscHostRow{Host: host, Impressions: a.impressions, Clicks: a.clicks})
	}
	// Descending by impressions, stable on host for ties.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			a, b := out[j-1], out[j]
			if b.Impressions > a.Impressions || (b.Impressions == a.Impressions && b.Host < a.Host) {
				out[j-1], out[j] = b, a
				continue
			}
			break
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func hostFromGSCPage(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	// strip scheme
	for _, scheme := range []string{"https://", "http://"} {
		if strings.HasPrefix(s, scheme) {
			s = s[len(scheme):]
			break
		}
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	return strings.ToLower(s)
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

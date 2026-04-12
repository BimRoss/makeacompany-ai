package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultHealthProbeTimeoutMillis = 1500
	defaultCookieStaleMinutes       = 180
	cookieHealthRedisKey            = "health:cookie-report:v1"
	cookieHealthTokenHeader         = "X-Health-Token"
)

type backendHealthResponse struct {
	Status     string                   `json:"status"`
	CheckedAt  string                   `json:"checkedAt"`
	Monitoring healthMonitoringResponse `json:"monitoring"`
	Cookies    cookieHealthSummary      `json:"cookies"`
	Indexer    indexerHealthSummary     `json:"indexer"`
	Workers    workerFleetHealthSummary `json:"workers"`
}

type healthMonitoringResponse struct {
	Status     string `json:"status"`
	Prometheus string `json:"prometheus"`
	Grafana    string `json:"grafana"`
}

type indexerHealthSummary struct {
	Status            string   `json:"status"`
	Ready             bool     `json:"ready"`
	WorkerCount       int      `json:"workerCount"`
	ActiveJobs        int      `json:"activeJobs"`
	ReceivedJobs      int      `json:"receivedJobs"`
	TotalJobsAccepted *int     `json:"totalJobsAccepted,omitempty"`
	JobsLastHour      *int     `json:"jobsLastHour,omitempty"`
	JobsPerMinute     *float64 `json:"jobsPerMinute,omitempty"`
	ErrorRate         *float64 `json:"errorRate,omitempty"`
	P95JobDurationMs  *float64 `json:"p95JobDurationMs,omitempty"`
	TelemetryStatus   string   `json:"telemetryStatus,omitempty"`
	TelemetryError    string   `json:"telemetryError,omitempty"`
	Error             string   `json:"error,omitempty"`
}

type workerFleetHealthSummary struct {
	Status              string                 `json:"status"`
	ReadyCount          int                    `json:"readyCount"`
	TotalCount          int                    `json:"totalCount"`
	JobsLastHour        *int                   `json:"jobsLastHour,omitempty"`
	InFlight            *int                   `json:"inFlight,omitempty"`
	RequestsPerMinute   *float64               `json:"requestsPerMinute,omitempty"`
	OutcomeOKPerMinute  *float64               `json:"outcomeOkPerMinute,omitempty"`
	OutcomeErrPerMinute *float64               `json:"outcomeErrPerMinute,omitempty"`
	OutcomeRLPerMinute  *float64               `json:"outcomeRateLimitedPerMinute,omitempty"`
	P95LatencyMs        *float64               `json:"p95LatencyMs,omitempty"`
	LastTelemetryAt     string                 `json:"lastTelemetryAt,omitempty"`
	RateLimitedAccounts int                    `json:"rateLimitedAccounts"`
	RateLimitedAPIKeys  int                    `json:"rateLimitedApiKeys"`
	TelemetryStatus     string                 `json:"telemetryStatus,omitempty"`
	TelemetryError      string                 `json:"telemetryError,omitempty"`
	Instances           []workerHealthInstance `json:"instances"`
}

type workerHealthInstance struct {
	Name                string   `json:"name"`
	Status              string   `json:"status"`
	Ready               bool     `json:"ready"`
	JobsLastHour        *int     `json:"jobsLastHour,omitempty"`
	ReadinessLatencyMs  *int64   `json:"readinessLatencyMs,omitempty"`
	InFlight            *int     `json:"inFlight,omitempty"`
	RequestsPerMinute   *float64 `json:"requestsPerMinute,omitempty"`
	OutcomeOKPerMinute  *float64 `json:"outcomeOkPerMinute,omitempty"`
	OutcomeErrPerMinute *float64 `json:"outcomeErrPerMinute,omitempty"`
	OutcomeRLPerMinute  *float64 `json:"outcomeRateLimitedPerMinute,omitempty"`
	P95LatencyMs        *float64 `json:"p95LatencyMs,omitempty"`
	LastTelemetryAt     string   `json:"lastTelemetryAt,omitempty"`
	RateLimitedAccounts int      `json:"rateLimitedAccounts"`
	RateLimitedAPIKeys  int      `json:"rateLimitedApiKeys"`
	TelemetryError      string   `json:"telemetryError,omitempty"`
	Error               string   `json:"error,omitempty"`
}

type cookieHealthSummary struct {
	Status             string `json:"status"`
	LastRunAt          string `json:"lastRunAt,omitempty"`
	AgeMinutes         *int   `json:"ageMinutes,omitempty"`
	SuccessCount       int    `json:"successCount"`
	FailCount          int    `json:"failCount"`
	TotalCount         int    `json:"totalCount"`
	Error              string `json:"error,omitempty"`
	AuthTokenExpiresAt string `json:"authTokenExpiresAt,omitempty"`
}

type cookieHealthFile struct {
	Status             string `json:"status"`
	LastRunAt          string `json:"lastRunAt"`
	SuccessCount       int    `json:"successCount"`
	FailCount          int    `json:"failCount"`
	AuthTokenExpiresAt string `json:"authTokenExpiresAt,omitempty"`
}

type healthChecker struct {
	httpClient         *http.Client
	redisClient        *redis.Client
	prometheusURL      string
	grafanaURL         string
	indexerURL         string
	workerURLs         []string
	cookieReportPath   string
	cookieHealthToken  string
	cookieStaleMinutes int
}

type indexerReadyResponse struct {
	Status       string   `json:"status"`
	ServiceName  string   `json:"service_name"`
	WorkerCount  int      `json:"worker_count"`
	WorkerURLs   []string `json:"worker_urls"`
	ReceivedJobs int      `json:"received_jobs"`
	ActiveJobs   int      `json:"active_jobs"`
}

type indexerRecentRequestsResponse struct {
	Status      string                    `json:"status"`
	ServiceName string                    `json:"service_name"`
	UpdatedAt   string                    `json:"updated_at"`
	Requests    []indexerRecentRequestLog `json:"requests"`
}

type indexerRecentRequestLog struct {
	AcceptedAt   string `json:"accepted_at"`
	RequestID    string `json:"request_id"`
	JobID        string `json:"job_id"`
	Capability   string `json:"capability"`
	QuerySummary string `json:"query_summary"`
	MaxResults   int    `json:"max_results"`
	Count        int    `json:"count"`
	HasCursor    bool   `json:"has_cursor"`
}

type workerReadyResponse struct {
	Status              string `json:"status"`
	ServiceName         string `json:"service_name"`
	AccountsAvailable   int    `json:"accounts_available"`
	AccountsCoolingDown int    `json:"accounts_cooling_down"`
	APIKeysAvailable    int    `json:"api_keys_available"`
	APIKeysCoolingDown  int    `json:"api_keys_cooling_down"`
}

func newHealthChecker(redisClient *redis.Client, cookieHealthToken string) *healthChecker {
	timeoutMillis := envIntOrDefault("HEALTH_PROBE_TIMEOUT_MS", defaultHealthProbeTimeoutMillis)
	return &healthChecker{
		httpClient: &http.Client{
			Timeout: time.Duration(timeoutMillis) * time.Millisecond,
		},
		redisClient:        redisClient,
		prometheusURL:      strings.TrimSpace(os.Getenv("HEALTH_PROMETHEUS_URL")),
		grafanaURL:         strings.TrimSpace(os.Getenv("HEALTH_GRAFANA_URL")),
		indexerURL:         strings.TrimSpace(os.Getenv("HEALTH_TWITTER_INDEXER_URL")),
		workerURLs:         splitCSVEnv("HEALTH_TWITTER_WORKER_URLS"),
		cookieReportPath:   strings.TrimSpace(os.Getenv("HEALTH_COOKIE_REPORT_PATH")),
		cookieHealthToken:  strings.TrimSpace(cookieHealthToken),
		cookieStaleMinutes: envIntOrDefault("HEALTH_COOKIE_STALE_AFTER_MINUTES", defaultCookieStaleMinutes),
	}
}

func (h *healthChecker) Build(ctx context.Context) backendHealthResponse {
	monitoring := h.checkMonitoring(ctx)
	cookies := h.readCookieHealth()
	indexer := h.buildIndexer(ctx)
	workers := h.buildWorkers(ctx)

	return backendHealthResponse{
		Status:     overallStatus(monitoring.Status, cookies.Status, indexer.Status, workers.Status),
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
		Monitoring: monitoring,
		Cookies:    cookies,
		Indexer:    indexer,
		Workers:    workers,
	}
}

func (h *healthChecker) checkMonitoring(ctx context.Context) healthMonitoringResponse {
	prometheus := "unknown"
	grafana := "unknown"
	if h.prometheusURL != "" {
		prometheus = h.probeHTTP(ctx, h.prometheusURL)
	}
	if h.grafanaURL != "" {
		grafana = h.probeHTTP(ctx, h.grafanaURL)
	}
	return healthMonitoringResponse{
		Status:     overallStatus(prometheus, grafana),
		Prometheus: prometheus,
		Grafana:    grafana,
	}
}

func (h *healthChecker) buildIndexer(ctx context.Context) indexerHealthSummary {
	if h.indexerURL == "" {
		return indexerHealthSummary{Status: "unknown", Error: "indexer probe is not configured"}
	}
	var ready indexerReadyResponse
	if err := h.fetchJSON(ctx, strings.TrimRight(h.indexerURL, "/")+"/readyz", &ready); err != nil {
		return indexerHealthSummary{Status: "degraded", Error: err.Error()}
	}

	totalJobsAccepted := ready.ReceivedJobs
	errorRate := 0.0
	summary := indexerHealthSummary{
		Status:            "ok",
		Ready:             true,
		WorkerCount:       ready.WorkerCount,
		ActiveJobs:        ready.ActiveJobs,
		ReceivedJobs:      ready.ReceivedJobs,
		TotalJobsAccepted: &totalJobsAccepted,
		ErrorRate:         &errorRate,
		TelemetryStatus:   "unknown",
	}

	if rpm, err := h.estimateIndexerRecentRequestsRPM(ctx, 100, 5*time.Minute); err == nil {
		summary.JobsPerMinute = rpm
	}
	if jobsLastHour, err := h.countIndexerRecentRequestsSince(ctx, 500, time.Hour); err == nil {
		summary.JobsLastHour = &jobsLastHour
	}
	if summary.JobsPerMinute != nil || summary.JobsLastHour != nil {
		summary.TelemetryStatus = "ok"
	}

	return summary
}

func (h *healthChecker) buildWorkers(ctx context.Context) workerFleetHealthSummary {
	if len(h.workerURLs) == 0 {
		return workerFleetHealthSummary{Status: "unknown", Instances: []workerHealthInstance{}}
	}

	instances := make([]workerHealthInstance, 0, len(h.workerURLs))
	readyCount := 0
	totalRateLimitedAccounts := 0
	totalRateLimitedAPIKeys := 0

	for _, workerURL := range h.workerURLs {
		instance := workerHealthInstance{Name: workerNameFromURL(workerURL), Status: "degraded"}
		var ready workerReadyResponse
		if err := h.fetchJSON(ctx, strings.TrimRight(workerURL, "/")+"/readyz", &ready); err != nil {
			instance.Error = err.Error()
			instances = append(instances, instance)
			continue
		}

		instance.Ready = true
		instance.Status = "ok"
		if ready.ServiceName != "" {
			instance.Name = ready.ServiceName
		}
		instance.RateLimitedAccounts = ready.AccountsCoolingDown
		instance.RateLimitedAPIKeys = ready.APIKeysCoolingDown
		totalRateLimitedAccounts += ready.AccountsCoolingDown
		totalRateLimitedAPIKeys += ready.APIKeysCoolingDown
		readyCount++
		instances = append(instances, instance)
	}

	status := "ok"
	if readyCount != len(h.workerURLs) {
		status = "degraded"
	}

	return workerFleetHealthSummary{
		Status:              status,
		ReadyCount:          readyCount,
		TotalCount:          len(h.workerURLs),
		RateLimitedAccounts: totalRateLimitedAccounts,
		RateLimitedAPIKeys:  totalRateLimitedAPIKeys,
		TelemetryStatus:     "unknown",
		Instances:           instances,
	}
}

func (h *healthChecker) probeHTTP(ctx context.Context, url string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "error"
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return "error"
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return "ok"
	}
	return "error"
}

func (h *healthChecker) fetchJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (h *healthChecker) readCookieHealth() cookieHealthSummary {
	if h.cookieReportPath != "" {
		if raw, err := os.ReadFile(h.cookieReportPath); err == nil {
			return buildCookieSummaryFromRaw(raw, h.cookieStaleMinutes)
		}
	}

	if h.redisClient == nil {
		return cookieHealthSummary{Status: "unknown", Error: "cookie health source is not configured"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	payload, err := h.redisClient.Get(ctx, cookieHealthRedisKey).Bytes()
	if err != nil {
		return cookieHealthSummary{Status: "unknown", Error: "cookie health source is not configured"}
	}
	return buildCookieSummaryFromRaw(payload, h.cookieStaleMinutes)
}

func buildCookieSummaryFromRaw(raw []byte, staleAfterMinutes int) cookieHealthSummary {
	var report cookieHealthFile
	if err := json.Unmarshal(raw, &report); err != nil {
		return cookieHealthSummary{Status: "degraded", Error: "cookie health report is invalid"}
	}

	summary := cookieHealthSummary{
		Status:             "ok",
		LastRunAt:          report.LastRunAt,
		SuccessCount:       report.SuccessCount,
		FailCount:          report.FailCount,
		TotalCount:         report.SuccessCount + report.FailCount,
		AuthTokenExpiresAt: report.AuthTokenExpiresAt,
	}
	if strings.EqualFold(report.Status, "error") || report.FailCount > 0 {
		summary.Status = "degraded"
	}
	lastRunAt, err := time.Parse(time.RFC3339, report.LastRunAt)
	if err != nil {
		summary.Status = "degraded"
		summary.Error = "cookie health report has invalid lastRunAt"
		return summary
	}
	ageMinutes := int(time.Since(lastRunAt).Minutes())
	if ageMinutes < 0 {
		ageMinutes = 0
	}
	summary.AgeMinutes = &ageMinutes
	if ageMinutes > staleAfterMinutes {
		summary.Status = "degraded"
		summary.Error = "cookie health report is stale"
	}
	return summary
}

func (h *healthChecker) fetchIndexerRecentRequests(ctx context.Context, limit, offset int) (indexerRecentRequestsResponse, error) {
	if h.indexerURL == "" {
		return indexerRecentRequestsResponse{}, errors.New("indexer probe is not configured")
	}
	if limit < 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	endpoint := fmt.Sprintf("%s/recent-requests?limit=%d&offset=%d", strings.TrimRight(h.indexerURL, "/"), limit, offset)
	var response indexerRecentRequestsResponse
	if err := h.fetchJSON(ctx, endpoint, &response); err != nil {
		return indexerRecentRequestsResponse{}, err
	}
	if response.Requests == nil {
		response.Requests = []indexerRecentRequestLog{}
	}
	return response, nil
}

func (h *healthChecker) estimateIndexerRecentRequestsRPM(ctx context.Context, limit int, window time.Duration) (*float64, error) {
	response, err := h.fetchIndexerRecentRequests(ctx, limit, 0)
	if err != nil {
		return nil, err
	}
	if len(response.Requests) == 0 || window <= 0 {
		value := 0.0
		return &value, nil
	}
	cutoff := time.Now().UTC().Add(-window)
	matches := 0
	for _, request := range response.Requests {
		acceptedAt, parseErr := time.Parse(time.RFC3339, request.AcceptedAt)
		if parseErr == nil && acceptedAt.After(cutoff) {
			matches++
		}
	}
	value := float64(matches) / window.Minutes()
	return &value, nil
}

func (h *healthChecker) countIndexerRecentRequestsSince(ctx context.Context, limit int, window time.Duration) (int, error) {
	response, err := h.fetchIndexerRecentRequests(ctx, limit, 0)
	if err != nil {
		return 0, err
	}
	if len(response.Requests) == 0 || window <= 0 {
		return 0, nil
	}
	cutoff := time.Now().UTC().Add(-window)
	matches := 0
	for _, request := range response.Requests {
		acceptedAt, parseErr := time.Parse(time.RFC3339, request.AcceptedAt)
		if parseErr == nil && acceptedAt.After(cutoff) {
			matches++
		}
	}
	return matches, nil
}

func (h *healthChecker) handleCookieHealthPush(w http.ResponseWriter, r *http.Request) {
	switch err := validateSharedToken(r, cookieHealthTokenHeader, h.cookieHealthToken); {
	case err == nil:
	case errors.Is(err, errSharedTokenNotConfigured):
		http.Error(w, "cookie health auth unavailable", http.StatusServiceUnavailable)
		return
	default:
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if err := validateCookieHealthPayload(body); err != nil {
		http.Error(w, "invalid cookie health payload", http.StatusBadRequest)
		return
	}
	if h.redisClient == nil {
		http.Error(w, "cookie health storage unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.redisClient.Set(ctx, cookieHealthRedisKey, body, 0).Err(); err != nil {
		http.Error(w, "failed to store cookie health payload", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func validateCookieHealthPayload(raw []byte) error {
	var payload cookieHealthFile
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}
	if payload.LastRunAt == "" {
		return errors.New("missing lastRunAt")
	}
	if _, err := time.Parse(time.RFC3339, payload.LastRunAt); err != nil {
		return err
	}
	if payload.SuccessCount < 0 || payload.FailCount < 0 {
		return errors.New("invalid counts")
	}
	if payload.AuthTokenExpiresAt != "" {
		if _, err := time.Parse(time.RFC3339, payload.AuthTokenExpiresAt); err != nil {
			return err
		}
	}
	return nil
}

var (
	errSharedTokenNotConfigured = errors.New("shared token is not configured")
	errSharedTokenMissing       = errors.New("shared token is required")
	errSharedTokenInvalid       = errors.New("shared token is invalid")
)

func validateSharedToken(r *http.Request, headerName, expectedToken string) error {
	expectedToken = strings.TrimSpace(expectedToken)
	if expectedToken == "" {
		return errSharedTokenNotConfigured
	}
	providedToken := strings.TrimSpace(r.Header.Get(headerName))
	if providedToken == "" {
		return errSharedTokenMissing
	}
	if subtle.ConstantTimeCompare([]byte(providedToken), []byte(expectedToken)) != 1 {
		return errSharedTokenInvalid
	}
	return nil
}

func splitCSVEnv(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func envIntOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func workerNameFromURL(raw string) string {
	parsed, err := neturl.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return raw
	}
	return parsed.Hostname()
}

func overallStatus(statuses ...string) string {
	hasUnknown := false
	for _, status := range statuses {
		switch status {
		case "degraded":
			return "degraded"
		case "unknown":
			hasUnknown = true
		}
	}
	if hasUnknown {
		return "unknown"
	}
	return "ok"
}

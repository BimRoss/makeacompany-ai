package app

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultHealthProbeTimeoutMillis = 1500

type backendHealthResponse struct {
	Status     string                   `json:"status"`
	CheckedAt  string                   `json:"checkedAt"`
	Monitoring healthMonitoringResponse `json:"monitoring"`
}

type healthMonitoringResponse struct {
	Status     string `json:"status"`
	Prometheus string `json:"prometheus"`
	Grafana    string `json:"grafana"`
}

type healthChecker struct {
	httpClient    *http.Client
	prometheusURL string
	grafanaURL    string
}

func newHealthChecker() *healthChecker {
	timeoutMillis := envIntOrDefault("HEALTH_PROBE_TIMEOUT_MS", defaultHealthProbeTimeoutMillis)
	return &healthChecker{
		httpClient: &http.Client{
			Timeout: time.Duration(timeoutMillis) * time.Millisecond,
		},
		prometheusURL: strings.TrimSpace(os.Getenv("HEALTH_PROMETHEUS_URL")),
		grafanaURL:    strings.TrimSpace(os.Getenv("HEALTH_GRAFANA_URL")),
	}
}

func (h *healthChecker) Build(ctx context.Context) backendHealthResponse {
	monitoring := h.checkMonitoring(ctx)
	return backendHealthResponse{
		Status:     monitoring.Status,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
		Monitoring: monitoring,
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

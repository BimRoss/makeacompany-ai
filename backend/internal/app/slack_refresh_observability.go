package app

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) recordSlackRefreshSuccess(snapshot string) {
	slackRefreshRunsTotal.WithLabelValues(strings.TrimSpace(snapshot), "success").Inc()
}

func (s *Server) recordSlackRefreshFailure(snapshot string) {
	slackRefreshRunsTotal.WithLabelValues(strings.TrimSpace(snapshot), "error").Inc()
}

func (s *Server) writeSlackRefreshError(w http.ResponseWriter, snapshot string, err error) {
	s.recordSlackRefreshFailure(snapshot)
	var upstream *UpstreamHTTPError
	if errors.As(err, &upstream) && upstream != nil {
		statusCode := strconv.Itoa(upstream.StatusCode)
		slackRefreshUpstreamHTTPStatusTotal.WithLabelValues(strings.TrimSpace(snapshot), statusCode).Inc()
		retryAfterRaw := strings.TrimSpace(upstream.RetryAfter)
		retryAfterSeconds, hasRetryAfter := parseRetryAfterSeconds(retryAfterRaw)
		payload := map[string]any{
			"error":         err.Error(),
			"upstreamHttp":  upstream.StatusCode,
			"source":        upstream.Source,
			"rateLimited":   upstream.StatusCode == http.StatusTooManyRequests,
			"retryAfterRaw": nil,
		}
		if retryAfterRaw != "" {
			payload["retryAfterRaw"] = retryAfterRaw
		}
		if hasRetryAfter {
			payload["retryAfterSeconds"] = retryAfterSeconds
		}
		s.log.Printf(
			"refresh %s snapshot upstream_http status=%d source=%q retry_after_raw=%q retry_after_seconds=%d has_retry_after=%t rate_limited=%t err=%q",
			snapshot, upstream.StatusCode, upstream.Source, retryAfterRaw, retryAfterSeconds, hasRetryAfter, upstream.StatusCode == http.StatusTooManyRequests, err.Error(),
		)
		writeJSON(w, http.StatusBadGateway, payload)
		return
	}
	s.log.Printf("refresh %s snapshot: %v", snapshot, err)
	writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
}

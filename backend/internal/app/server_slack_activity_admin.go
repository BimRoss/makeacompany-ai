package app

import (
	"errors"
	"net/http"
	"strings"
	"time"
)

// handleInternalRefreshSlackActivityDaily rebuilds the per-day Slack activity snapshot from Slack.
// Triggered by a daily CronJob (registered in rancher-admin). Day defaults to "yesterday UTC" if the
// query param is empty so the cron can run a few minutes after 00:00Z without a date arg.
func (s *Server) handleInternalRefreshSlackActivityDaily(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	outcome := "error"
	start := time.Now()
	defer func() {
		cronjobDurationSeconds.WithLabelValues("slack-activity-daily", outcome).Observe(time.Since(start).Seconds())
	}()
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN, same as slack-orchestrator; legacy SLACK_BOT_TOKEN still accepted)"})
		return
	}
	day := strings.TrimSpace(r.URL.Query().Get("day"))
	if day == "" {
		day = time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	}
	activity, err := FetchSlackActivityDay(r.Context(), s.cfg.SlackBotToken, day)
	if err != nil {
		s.writeSlackRefreshError(w, "slack_activity_daily", err)
		return
	}
	blob, err := MarshalSlackActivityDay(activity)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := s.store.SaveSlackActivityDaily(r.Context(), activity.Day, blob); err != nil {
		s.recordSlackRefreshFailure("slack_activity_daily")
		s.log.Printf("save slack activity daily %s: %v", activity.Day, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	s.recordSlackRefreshSuccess("slack_activity_daily")
	outcome = "success"
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"day":             activity.Day,
		"channelsScanned": activity.ChannelsScanned,
		"channelsSkipped": activity.ChannelsSkipped,
		"messagesTotal":   activity.MessagesTotal,
		"uniqueUsers":     activity.UniqueUsers,
		"fetchedAt":       activity.FetchedAt,
	})
}

// handleAdminSlackActivityDaily returns the cached per-day snapshot. Day param defaults to
// "yesterday UTC" to mirror what the cron writes.
func (s *Server) handleAdminSlackActivityDaily(w http.ResponseWriter, r *http.Request) {
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
	day := strings.TrimSpace(r.URL.Query().Get("day"))
	if day == "" {
		day = time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	}
	if _, err := time.ParseInLocation("2006-01-02", day, time.UTC); err != nil {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "day must be YYYY-MM-DD UTC"})
		return
	}
	raw, err := s.store.GetSlackActivityDailyBytes(r.Context(), day)
	if err != nil {
		if errors.Is(err, ErrSlackActivityDailyMissing) {
			writeJSONNoStore(w, http.StatusOK, map[string]any{
				"day":      day,
				"missing":  true,
				"note":     "No snapshot yet for this day. CronJob POST /v1/internal/refresh-slack-activity-daily?day=" + day + " writes it.",
				"channels": []any{},
				"byUser":   map[string]int{},
			})
			return
		}
		s.log.Printf("admin slack activity daily get %s: %v", day, err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	parsed, err := ParseSlackActivityDay(raw)
	if err != nil {
		s.log.Printf("admin slack activity daily parse %s: %v", day, err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, parsed)
}

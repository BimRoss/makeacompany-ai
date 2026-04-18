package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) handleAdminCapabilityRoutingEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	chID := strings.TrimSpace(r.URL.Query().Get("channelId"))
	limit := 50
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	key := strings.TrimSpace(s.cfg.CapabilityRoutingEventsRedisKey)
	if key == "" {
		key = "employee-factory:capability_routing_events"
	}
	rows, err := s.store.ListCapabilityRoutingObsEvents(r.Context(), key, chID, limit)
	if err != nil {
		s.log.Printf("admin capability routing events: %v", err)
		http.Error(w, "redis error", http.StatusInternalServerError)
		return
	}
	events := make([]map[string]any, 0, len(rows))
	for _, raw := range rows {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		events = append(events, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events":    events,
		"redisKey":  key,
		"channelId": chID,
	})
}

package app

import (
	"errors"
	"net/http"
	"strings"
	"time"
)

// handleInternalRefreshSlackUsersSnapshot rebuilds the Redis snapshot from Slack (BACKEND_INTERNAL_SERVICE_TOKEN only).
func (s *Server) handleInternalRefreshSlackUsersSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (SLACK_BOT_TOKEN, same as slack-orchestrator)"})
		return
	}
	users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackBotToken)
	if err != nil {
		s.log.Printf("refresh slack users snapshot: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	blob, err := MarshalSlackUsersSnapshot(users)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := s.store.SaveSlackUsersSnapshot(r.Context(), blob); err != nil {
		s.log.Printf("save slack users snapshot: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	synced, syncErr := s.store.SyncSlackUserIndexFromWorkspaceUsers(r.Context(), users)
	if syncErr != nil {
		s.log.Printf("sync slack user index from workspace users: %v", syncErr)
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  true,
		"rowCount":            len(users),
		"slackEmailIndexSync": synced,
		"syncError":           errStringOrNil(syncErr),
		"fetchedAt":           fetchedAt,
	})
}

// handleAdminSlackWorkspaceUsers returns cached Slack members or a live Slack query when source=live.
func (s *Server) handleAdminSlackWorkspaceUsers(w http.ResponseWriter, r *http.Request) {
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
	live := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("source")), "live")
	if live {
		if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
			writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (SLACK_BOT_TOKEN, same as slack-orchestrator)"})
			return
		}
		users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackBotToken)
		if err != nil {
			s.log.Printf("admin slack users live: %v", err)
			writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		resp := map[string]any{
			"source":       "live",
			"fetchedAt":    time.Now().UTC().Format(time.RFC3339),
			"users":        users,
			"snapshotNote": "Queried Slack users.list; snapshot and slack→email index written to Redis (same as internal refresh).",
		}
		if blob, mErr := MarshalSlackUsersSnapshot(users); mErr != nil {
			s.log.Printf("admin slack users live marshal snapshot: %v", mErr)
			resp["redisSaveError"] = mErr.Error()
		} else if svErr := s.store.SaveSlackUsersSnapshot(r.Context(), blob); svErr != nil {
			s.log.Printf("admin slack users live save snapshot: %v", svErr)
			resp["redisSaveError"] = svErr.Error()
		} else {
			synced, syncErr := s.store.SyncSlackUserIndexFromWorkspaceUsers(r.Context(), users)
			resp["slackEmailIndexSync"] = synced
			resp["syncError"] = errStringOrNil(syncErr)
			if syncErr != nil {
				s.log.Printf("admin slack users live sync index: %v", syncErr)
			}
		}
		writeJSONNoStore(w, http.StatusOK, resp)
		return
	}

	raw, err := s.store.GetSlackUsersSnapshotBytes(r.Context())
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			writeJSONNoStore(w, http.StatusOK, map[string]any{
				"source":       "snapshot",
				"fetchedAt":    nil,
				"users":        []SlackWorkspaceUser{},
				"snapshotNote": "No snapshot yet. CronJob POST /v1/internal/refresh-slack-users-snapshot or use ?source=live once.",
			})
			return
		}
		s.log.Printf("admin slack users snapshot get: %v", err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		s.log.Printf("admin slack users snapshot parse: %v", err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"source":       "snapshot",
		"fetchedAt":    env.FetchedAt,
		"users":        env.Users,
		"snapshotNote": env.SnapshotNote,
	})
}

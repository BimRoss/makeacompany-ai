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
	if strings.TrimSpace(s.cfg.SlackWorkspaceUsersBotToken) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack workspace users token is not configured (SLACK_WORKSPACE_USERS_BOT_TOKEN)"})
		return
	}
	users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackWorkspaceUsersBotToken)
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
		http.Error(w, "redis error", http.StatusInternalServerError)
		return
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"rowCount":  len(users),
		"fetchedAt": fetchedAt,
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
		if strings.TrimSpace(s.cfg.SlackWorkspaceUsersBotToken) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack workspace users token is not configured (SLACK_WORKSPACE_USERS_BOT_TOKEN)"})
			return
		}
		users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackWorkspaceUsersBotToken)
		if err != nil {
			s.log.Printf("admin slack users live: %v", err)
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"source":       "live",
			"fetchedAt":    time.Now().UTC().Format(time.RFC3339),
			"users":        users,
			"snapshotNote": "Queried Slack users.list on this request (not written to Redis).",
		})
		return
	}

	raw, err := s.store.GetSlackUsersSnapshotBytes(r.Context())
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			writeJSON(w, http.StatusOK, map[string]any{
				"source":       "snapshot",
				"fetchedAt":    nil,
				"users":        []SlackWorkspaceUser{},
				"snapshotNote": "No snapshot yet. CronJob POST /v1/internal/refresh-slack-users-snapshot or use ?source=live once.",
			})
			return
		}
		s.log.Printf("admin slack users snapshot get: %v", err)
		http.Error(w, "redis error", http.StatusInternalServerError)
		return
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		s.log.Printf("admin slack users snapshot parse: %v", err)
		http.Error(w, "corrupt snapshot", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"source":       "snapshot",
		"fetchedAt":    env.FetchedAt,
		"users":        env.Users,
		"snapshotNote": env.SnapshotNote,
	})
}

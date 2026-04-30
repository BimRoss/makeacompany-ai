package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

// handleInternalRefreshSlackUsersSnapshot rebuilds the Redis snapshot from Slack.
func (s *Server) handleInternalRefreshSlackUsersSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (SLACK_BOT_TOKEN, same as slack-orchestrator)"})
		return
	}
	users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackBotToken)
	if err != nil {
		s.writeSlackRefreshError(w, "workspace_users", err)
		return
	}
	blob, err := MarshalSlackUsersSnapshot(users)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := s.store.SaveSlackUsersSnapshot(r.Context(), blob); err != nil {
		s.recordSlackRefreshFailure("workspace_users")
		s.log.Printf("save slack users snapshot: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	synced, syncErr := s.store.SyncSlackUserIndexFromWorkspaceUsers(r.Context(), users)
	if syncErr != nil {
		s.log.Printf("sync slack user index from workspace users: %v", syncErr)
	}
	s.recordSlackRefreshSuccess("workspace_users")
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                  true,
		"rowCount":            len(users),
		"slackEmailIndexSync": synced,
		"syncError":           errStringOrNil(syncErr),
		"fetchedAt":           fetchedAt,
	})
}

// tryWarmSlackUsersSnapshotWhenMissing calls Slack users.list and writes Redis when the snapshot key is absent (same
// cold-start idea as admin slack-member-channels and Stripe waitlist snapshot warm).
func (s *Server) tryWarmSlackUsersSnapshotWhenMissing(ctx context.Context) map[string]any {
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		return nil
	}
	users, err := FetchSlackWorkspaceUsers(ctx, s.cfg.SlackBotToken)
	if err != nil {
		s.log.Printf("admin slack users snapshot warm (missing): slack: %v", err)
		return nil
	}
	blob, mErr := MarshalSlackUsersSnapshot(users)
	if mErr != nil {
		s.log.Printf("admin slack users snapshot warm (missing): marshal: %v", mErr)
		return nil
	}
	if svErr := s.store.SaveSlackUsersSnapshot(ctx, blob); svErr != nil {
		s.log.Printf("admin slack users snapshot warm (missing): save: %v", svErr)
		return nil
	}
	synced, syncErr := s.store.SyncSlackUserIndexFromWorkspaceUsers(ctx, users)
	s.store.EnrichSlackWorkspaceUsersWithProfileTerms(ctx, users)
	if syncErr != nil {
		s.log.Printf("admin slack users snapshot warm (missing): sync index: %v", syncErr)
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"source":              "snapshot",
		"fetchedAt":           fetchedAt,
		"users":               users,
		"snapshotNote":        "Filled from Slack users.list (Redis workspace snapshot was missing).",
		"slackEmailIndexSync": synced,
		"syncError":           errStringOrNil(syncErr),
	}
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
			s.store.EnrichSlackWorkspaceUsersWithProfileTerms(r.Context(), users)
			resp["users"] = users
		}
		writeJSONNoStore(w, http.StatusOK, resp)
		return
	}

	raw, err := s.store.GetSlackUsersSnapshotBytes(r.Context())
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			if warm := s.tryWarmSlackUsersSnapshotWhenMissing(r.Context()); warm != nil {
				writeJSONNoStore(w, http.StatusOK, warm)
				return
			}
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
	s.store.EnrichSlackWorkspaceUsersWithProfileTerms(r.Context(), env.Users)
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"source":       "snapshot",
		"fetchedAt":    env.FetchedAt,
		"users":        env.Users,
		"snapshotNote": env.SnapshotNote,
	})
}

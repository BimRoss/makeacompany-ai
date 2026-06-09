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
	outcome := "error"
	start := time.Now()
	defer func() {
		cronjobDurationSeconds.WithLabelValues("slack-users-snapshot", outcome).Observe(time.Since(start).Seconds())
	}()
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN, same as slack-orchestrator; legacy SLACK_BOT_TOKEN still accepted)"})
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
	freeLifetimeAssigned, trialingAssigned := s.assignLifecycleTiersForWorkspaceUsers(r.Context(), users)
	s.recordSlackRefreshSuccess("workspace_users")
	outcome = "success"
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                       true,
		"rowCount":                 len(users),
		"slackEmailIndexSync":      synced,
		"syncError":                errStringOrNil(syncErr),
		"lifecycleFreeLifetimeNew": freeLifetimeAssigned,
		"lifecycleTrialingNew":     trialingAssigned,
		"fetchedAt":                fetchedAt,
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
	s.assignLifecycleTiersForWorkspaceUsers(ctx, users)
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

// filterSlackUsersForDisplay drops isDeleted=true rows unless includeDeleted is set.
// Snapshot in Redis always stores the full list; this only shapes the admin response.
func filterSlackUsersForDisplay(users []SlackWorkspaceUser, includeDeleted bool) (kept []SlackWorkspaceUser, hidden int) {
	if includeDeleted {
		return users, 0
	}
	kept = make([]SlackWorkspaceUser, 0, len(users))
	for _, u := range users {
		if u.IsDeleted {
			hidden++
			continue
		}
		kept = append(kept, u)
	}
	return kept, hidden
}

// handleAdminSlackWorkspaceUsers returns cached Slack members or a live Slack query when source=live.
func (s *Server) handleAdminSlackWorkspaceUsers(w http.ResponseWriter, r *http.Request) {
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
	live := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("source")), "live")
	includeDeleted := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("include_deleted")), "true")
	if live {
		if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
			writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN, same as slack-orchestrator; legacy SLACK_BOT_TOKEN still accepted)"})
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
			"snapshotNote": "Queried Slack users.list; snapshot and slack→email index written to Redis (same as internal refresh).",
		}
		// Snapshot to Redis BEFORE filtering so the stored blob keeps full fidelity.
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
			s.assignLifecycleTiersForWorkspaceUsers(r.Context(), users)
			s.store.EnrichSlackWorkspaceUsersWithProfileTerms(r.Context(), users)
		}
		visible, hidden := filterSlackUsersForDisplay(users, includeDeleted)
		resp["users"] = visible
		resp["deletedHidden"] = hidden
		resp["includeDeleted"] = includeDeleted
		writeJSONNoStore(w, http.StatusOK, resp)
		return
	}

	raw, err := s.store.GetSlackUsersSnapshotBytes(r.Context())
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			if warm := s.tryWarmSlackUsersSnapshotWhenMissing(r.Context()); warm != nil {
				if all, okCast := warm["users"].([]SlackWorkspaceUser); okCast {
					visible, hidden := filterSlackUsersForDisplay(all, includeDeleted)
					warm["users"] = visible
					warm["deletedHidden"] = hidden
					warm["includeDeleted"] = includeDeleted
				}
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
	visible, hidden := filterSlackUsersForDisplay(env.Users, includeDeleted)
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"source":         "snapshot",
		"fetchedAt":      env.FetchedAt,
		"users":          visible,
		"snapshotNote":   env.SnapshotNote,
		"deletedHidden":  hidden,
		"includeDeleted": includeDeleted,
	})
}

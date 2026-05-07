package app

import (
	"errors"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

// handleAdminSlackBotAuthorProfiles returns Slack user IDs → names + portraits for transcript/admin UI,
// sourced from Slack users.list on the backend (same token as `/v1/admin/slack-workspace-users`).
func (s *Server) handleAdminSlackBotAuthorProfiles(w http.ResponseWriter, r *http.Request) {
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
	s.writeSlackBotAuthorProfiles(w, r)
}

// handlePortalSlackBotAuthorProfiles is the same payload as the admin route for signed-in portal sessions.
func (s *Server) handlePortalSlackBotAuthorProfiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil && !errors.Is(err, redis.Nil) {
		s.log.Printf("portal slack-bot-author-profiles session: %v", err)
	}
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.writeSlackBotAuthorProfiles(w, r)
}

func (s *Server) writeSlackBotAuthorProfiles(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(s.cfg.SlackBotToken) == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{
			"error": "slack bot token is not configured (ORCHESTRATOR_SLACK_BOT_TOKEN, same as slack-orchestrator; legacy SLACK_BOT_TOKEN still accepted)",
		})
		return
	}
	users, err := FetchSlackWorkspaceUsers(r.Context(), s.cfg.SlackBotToken)
	if err != nil {
		s.log.Printf("slack-bot-author-profiles users.list: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	envBots := SlackBotAuthorProfilesFromOSEnv()
	profiles := BuildMergedSlackAuthorProfiles(users, envBots)
	writeJSONNoStore(w, http.StatusOK, map[string]any{"profiles": profiles})
}

package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// teamModeRequiredScopes are the bot scopes the PA team-mode membership resolver
// needs to call conversations.members (channels:read for public, groups:read for
// private). channels:read has long been in the manifest; groups:read was added
// for #653, so apps installed before then lack it.
var teamModeRequiredScopes = []string{"channels:read", "groups:read"}

// handlePersonalAgentTeamScopeStatus reports whether one of the signed-in
// owner's agents actually has the bot scopes team mode needs (#653). This makes
// the /me reinstall affordance DETECT-DRIVEN: the UI shows an explicit
// "reinstall to enable team mode" state only for agents whose installed app is
// genuinely missing a scope, rather than a blanket note on every agent.
//
//	GET /v1/me/personal-agents/team-scope-status?agentId=...
//	→ { "teamScopesReady": bool, "verified": bool, "missing": ["groups:read"] }
//
// verified=false means we couldn't determine the scopes (writer disabled in
// local dev, unreadable token, or a transient Slack error) — the UI treats that
// as "don't block the toggle" rather than falsely prompting a reinstall.
func (s *Server) handlePersonalAgentTeamScopeStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	unverified := map[string]any{"teamScopesReady": false, "verified": false}
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		writeJSON(w, http.StatusOK, unverified)
		return
	}
	token, err := s.personalAgent.ReadAgentBotToken(r.Context(), rec.ID)
	if err != nil || strings.TrimSpace(token) == "" {
		writeJSON(w, http.StatusOK, unverified)
		return
	}
	scopes, err := slackTokenScopes(r.Context(), token)
	if err != nil {
		s.log.Printf("team-scope-status: scope check for %s: %v", rec.ID, err)
		writeJSON(w, http.StatusOK, unverified)
		return
	}

	have := make(map[string]bool, len(scopes))
	for _, sc := range scopes {
		have[strings.TrimSpace(sc)] = true
	}
	missing := make([]string, 0, len(teamModeRequiredScopes))
	for _, need := range teamModeRequiredScopes {
		if !have[need] {
			missing = append(missing, need)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"teamScopesReady": len(missing) == 0,
		"verified":        true,
		"missing":         missing,
	})
}

// slackTokenScopes returns the OAuth scopes granted to a bot token, read from
// the X-OAuth-Scopes header Slack returns on every Web API response (auth.test
// is the cheapest call). Errors on transport failure, a non-200, or a missing
// header (treated upstream as "unverified", never as "scopes missing").
func slackTokenScopes(ctx context.Context, botToken string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/auth.test", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(botToken))
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("auth.test status %d", resp.StatusCode)
	}
	raw := resp.Header.Get("X-OAuth-Scopes")
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("auth.test returned no X-OAuth-Scopes header")
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out, nil
}

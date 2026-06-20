package app

import "net/http"

// adminPersonalAgentSummary is the lightweight, secrets-free per-agent view the
// /admin rate-limit-headroom widget needs to label personal-agent pool rows
// with their real app name instead of an agent-id hash. Keyed by agent id.
type adminPersonalAgentSummary struct {
	AgentID          string `json:"agentId"`
	DisplayName      string `json:"displayName"`
	OwnerSlackUserID string `json:"ownerSlackUserId,omitempty"`
	BotUserID        string `json:"botUserId,omitempty"`
	Status           string `json:"status,omitempty"`
}

// handleAdminPersonalAgents returns a name-only summary of every personal
// agent so admin surfaces can resolve agent-id → app name. The oauth-pool
// widget discovers PA pods from K8s (which only carry the agent id + the
// owner's Slack id, not the app's display name) and joins this list on
// agentId to render "Jonai" instead of "dddad820". Read-only; same
// admin-or-internal-service auth as the other /v1/admin endpoints; never
// includes tokens/secrets/prompts.
func (s *Server) handleAdminPersonalAgents(w http.ResponseWriter, r *http.Request) {
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
	recs, err := s.store.ListPersonalAgents(r.Context())
	if err != nil {
		s.log.Printf("admin personal-agents list: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	out := make([]adminPersonalAgentSummary, 0, len(recs))
	for _, rec := range recs {
		out = append(out, adminPersonalAgentSummary{
			AgentID:          rec.ID,
			DisplayName:      rec.DisplayName,
			OwnerSlackUserID: rec.OwnerSlackUserID,
			BotUserID:        rec.BotUserID,
			Status:           rec.Status,
		})
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"agents": out})
}

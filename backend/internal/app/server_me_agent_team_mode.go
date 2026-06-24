package app

import (
	"encoding/json"
	"net/http"
)

// setAgentTeamModeRequest is the body for POST /v1/me/personal-agents/team-mode.
// agentId selects the target agent (resolved + ownership-validated by
// ownerPersonalAgentForRequest via the shared body-peek path, #651); enabled is
// the desired team-mode state.
type setAgentTeamModeRequest struct {
	// AgentID is read by ownerPersonalAgentForRequest's body peek; declared here
	// too so the handler's own decode doesn't choke on the unknown field and so
	// the contract is explicit at the call site.
	AgentID string `json:"agentId"`
	Enabled bool   `json:"enabled"`
}

// handleSetMyPersonalAgentTeamMode flips team mode (#653) on one of the signed-in
// owner's agents. Team mode lets anyone in a Slack channel the owner AND the bot
// both belong to talk to the agent and use everything it can — its connected
// Google account, memory, and tools — acting on the owner's behalf. The actual
// enforcement (owner gate + fail-closed channel-membership resolver) lives in
// the PA pod; this endpoint only:
//
//  1. persists the durable TeamMode flag (drives the /me toggle state + badge),
//  2. patches PERSONAL_AGENT_TEAM_MODE on the agent's runtime Secret, and
//  3. rolls the pod so the resolver re-reads the new value.
//
// NO connection or memory teardown happens on toggle — turning team mode off
// just stops the agent answering non-owners; nothing it holds is wiped.
//
// Existing-app caveat: the resolver calls conversations.members, which needs the
// bot scopes channels:read + groups:read. Those are in the manifest for
// newly-created apps, but apps installed before #653 won't have groups:read
// retroactively — the resolver then fails closed (answers nobody) and logs. We
// don't force a reinstall here; the /me UI surfaces a standing "you may need to
// reinstall the Slack app to grant channel access" hint when team mode is on.
func (s *Server) handleSetMyPersonalAgentTeamMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	var req setAgentTeamModeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// Persist the durable flag first — it's the source of truth for the toggle
	// state + badge even if the pod patch/roll lags or the writer is disabled
	// (local dev). The pod won't honor team messages until the env lands, but
	// the /me UI reflects intent immediately.
	if err := s.store.SetPersonalAgentTeamMode(r.Context(), rec.ID, req.Enabled); err != nil {
		s.log.Printf("set personal agent team mode for %s: %v", rec.ID, err)
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}

	// Push PERSONAL_AGENT_TEAM_MODE onto the pod and roll it so the resolver
	// re-reads. Best-effort + logged: a Slack-side / record flip already landed,
	// and the reconciler re-converges pod env on its next pass, so a transient
	// K8s error shouldn't 500 the toggle. NO Google/memory teardown.
	envApplied := false
	if s.personalAgent != nil && !s.personalAgent.Disabled() {
		if err := s.personalAgent.PatchAgentTeamMode(r.Context(), rec.ID, req.Enabled); err != nil {
			s.log.Printf("patch team mode env for %s: %v", rec.ID, err)
		} else if err := s.personalAgent.RestartAgentDeployment(r.Context(), rec.ID); err != nil {
			s.log.Printf("restart agent after team mode change for %s: %v", rec.ID, err)
			envApplied = true // env landed; only the roll hiccuped
		} else {
			envApplied = true
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"agentId":  rec.ID,
		"teamMode": req.Enabled,
		// envApplied=false means the pod hasn't picked up the new value yet (writer
		// disabled or a transient K8s error). The flag is still persisted; the UI
		// can use this to soften its confirmation copy if it wants.
		"envApplied": envApplied,
	})
}

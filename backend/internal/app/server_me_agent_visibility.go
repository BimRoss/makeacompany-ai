package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

type setAgentVisibilityRequest struct {
	// Visibility is one of private/unlisted/public. Unrecognized values are
	// normalized to private by the store (fail closed).
	Visibility string `json:"visibility"`
	// ShowIntelligence is applied only when present, so the caller can flip
	// visibility without disturbing the intelligence opt-in. Pointer so the
	// zero value (false) is distinguishable from "omitted".
	ShowIntelligence *bool `json:"showIntelligence,omitempty"`
}

// handleSetMyPersonalAgentVisibility lets the signed-in owner change the
// public-showcase visibility (#657) of one of their agents and toggle the
// intelligence opt-in. This is what the "Share my agent" button calls when it
// flips a still-private agent to unlisted so the link it just copied resolves.
//
// Ownership is checked against the agent record's OwnerSlackUserID rather than
// the by-owner index, so it stays correct once a user has more than one agent
// (#651). A non-owner gets 404, not 403 — same don't-confirm-existence posture
// as the public endpoint.
func (s *Server) handleSetMyPersonalAgentVisibility(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil || strings.TrimSpace(slackUserID) == "" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		http.NotFound(w, r)
		return
	}

	var req setAgentVisibilityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	rec, err := s.store.GetPersonalAgent(r.Context(), agentID)
	if errors.Is(err, redis.Nil) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	if strings.TrimSpace(rec.OwnerSlackUserID) != strings.TrimSpace(slackUserID) {
		// Not your agent. Don't confirm it exists.
		http.NotFound(w, r)
		return
	}

	if err := s.store.SetPersonalAgentVisibility(r.Context(), agentID, req.Visibility, req.ShowIntelligence); err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}

	effective := effectivePersonalAgentVisibility(req.Visibility)
	showIntel := rec.ShowIntelligence
	if req.ShowIntelligence != nil {
		showIntel = *req.ShowIntelligence
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"agentId":          agentID,
		"visibility":       effective,
		"showIntelligence": showIntel,
		"publicUrl":        strings.TrimRight(s.cfg.AppBaseURL, "/") + "/a/" + agentID,
	})
}

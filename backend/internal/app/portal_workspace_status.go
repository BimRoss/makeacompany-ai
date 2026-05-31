package app

import (
	"errors"
	"net/http"
	"strings"
)

// GET /v1/portal/workspace/status?channelId=Cxxxx — read-only view of which
// operators have a Workspace credential bound to this channel's customer
// Ross pod. Powers the WorkspaceConnectPanel on /[channelId] so the panel
// can render real state after page refresh, not just the post-callback
// ?workspace_connected=1 URL flag.
//
// Auth: intentionally open by channelId. The response reveals only the
// channel's connected-operator emails + slot numbers, which are already
// derivable from Slack channel membership for anyone in the channel. The
// state-changing endpoints (connect/finish, disconnect/finish) remain
// gated by the portal session bearer.
//
// Driver: BimRoss/google-workspace-mcp#15 Section A4.

type portalWorkspaceStatusResponse struct {
	Connected bool                         `json:"connected"`
	Namespace string                       `json:"namespace,omitempty"`
	Operators []WorkspaceCredentialSummary `json:"operators"`
}

func (s *Server) handlePortalWorkspaceStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.workspace.Disabled() {
		http.Error(w, "workspace integration not configured", http.StatusServiceUnavailable)
		return
	}
	chID := strings.TrimSpace(r.URL.Query().Get("channelId"))
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ns, ops, err := s.workspace.ListWorkspaceCredentials(r.Context(), chID)
	if errors.Is(err, ErrUnknownTenant) {
		http.Error(w, "tenant not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Printf("workspace status list failed for channel=%s: %v", chID, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	writeJSONNoStore(w, http.StatusOK, portalWorkspaceStatusResponse{
		Connected: len(ops) > 0,
		Namespace: ns,
		Operators: ops,
	})
}

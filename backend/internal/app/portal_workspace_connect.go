package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// /v1/portal/workspace/connect/finish — completes the Workspace OAuth dance
// initiated by the Next.js portal (BimRoss/makeacompany-ai PR #151). Receives
// the DCR client + refresh token from the callback handler, validates the
// caller has a portal session for the channel, writes the per-operator
// Secret in the customer Ross pod's namespace, triggers a pod restart so
// the sidecar boots with the new credentials, and audit-logs the consent.
//
// Driver: BimRoss/google-workspace-mcp#15 phase 3a. RBAC scoped narrowly
// to the claude-code-ross-customer-grant namespace for the hand-roll PR
// (rancher-admin#465); broadens once #354 templates customer pods.

type portalWorkspaceConnectFinishRequest struct {
	ChannelID    string `json:"channelId"`
	DCR          struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	} `json:"dcr"`
	RefreshToken string `json:"refreshToken"`
	Scope        string `json:"scope"`
}

type portalWorkspaceConnectFinishResponse struct {
	OK        bool   `json:"ok"`
	Namespace string `json:"namespace,omitempty"`
	Slot      int    `json:"slot,omitempty"`
}

func (s *Server) handlePortalWorkspaceConnectFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.workspace.Disabled() {
		http.Error(w, "workspace integration not configured", http.StatusServiceUnavailable)
		return
	}

	var req portalWorkspaceConnectFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	clientID := strings.TrimSpace(req.DCR.ClientID)
	clientSecret := strings.TrimSpace(req.DCR.ClientSecret)
	refreshToken := strings.TrimSpace(req.RefreshToken)
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Each credential field is a known minimum length from the gateway:
	// DCR client_id ~40 chars, client_secret ~60 chars, refresh_token ~640.
	// Reject obvious malformedness without trying to decode the token.
	if len(clientID) < 16 || len(clientSecret) < 16 || len(refreshToken) < 64 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	session, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), chID)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ns, slot, writeErr := s.workspace.WriteWorkspaceCredentials(
		r.Context(), chID, session.Email, clientID, clientSecret, refreshToken,
	)

	// Audit before deciding on the response — we want failures recorded too.
	outcome := "ok"
	detail := ""
	statusCode := http.StatusOK
	switch {
	case errors.Is(writeErr, ErrUnknownTenant):
		outcome = "denied"
		detail = writeErr.Error()
		statusCode = http.StatusNotFound
	case errors.Is(writeErr, ErrUnknownOperator):
		outcome = "denied"
		detail = writeErr.Error()
		statusCode = http.StatusForbidden
	case writeErr != nil:
		outcome = "failed"
		detail = writeErr.Error()
		statusCode = http.StatusInternalServerError
	}

	auditErr := s.store.AppendWorkspaceAuditEvent(r.Context(), WorkspaceAuditEvent{
		Event:     "workspace.consent.completed",
		TenantID:  chID,
		Operator:  session.Email,
		Slot:      slot,
		Namespace: ns,
		Scope:     strings.TrimSpace(req.Scope),
		Outcome:   outcome,
		Detail:    detail,
	})
	if auditErr != nil {
		s.log.Printf("workspace audit append failed: %v", auditErr)
	}

	if writeErr != nil {
		s.log.Printf("workspace write failed for channel=%s operator=%s: %v",
			chID, session.Email, writeErr)
		http.Error(w, outcome, statusCode)
		return
	}
	writeJSON(w, http.StatusOK, portalWorkspaceConnectFinishResponse{
		OK:        true,
		Namespace: ns,
		Slot:      slot,
	})
}

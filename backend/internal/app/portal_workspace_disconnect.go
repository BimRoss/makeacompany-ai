package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// /v1/portal/workspace/disconnect/finish — symmetric counterpart to
// /v1/portal/workspace/connect/finish. The signed-in portal user
// disconnects their own Workspace credential from a channel they have a
// session for. The handler reads the Secret first to pull the refresh
// token, best-effort revokes it at Google's /revoke endpoint, then
// deletes the Secret + restarts the customer Ross pod so the sidecar
// re-enters waiting state immediately.
//
// Driver: BimRoss/google-workspace-mcp#15 Section A2.

type portalWorkspaceDisconnectFinishRequest struct {
	ChannelID string `json:"channelId"`
}

type portalWorkspaceDisconnectFinishResponse struct {
	OK        bool   `json:"ok"`
	Namespace string `json:"namespace,omitempty"`
	Slot      int    `json:"slot,omitempty"`
	Revoked   bool   `json:"revoked"`
}

// googleRevokeEndpoint is the OAuth 2.0 token revocation endpoint per
// RFC 7009 + Google's docs. Overridable in tests.
var googleRevokeEndpoint = "https://oauth2.googleapis.com/revoke"

func (s *Server) handlePortalWorkspaceDisconnectFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.workspace.Disabled() {
		http.Error(w, "workspace integration not configured", http.StatusServiceUnavailable)
		return
	}

	var req portalWorkspaceDisconnectFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	chID := strings.TrimSpace(req.ChannelID)
	if !ValidSlackChannelID(chID) {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	session, err := s.validatePortalSessionForChannel(r.Context(), tokenFromAuthHeader(r), chID)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ns, slot, refreshToken, delErr := s.workspace.DeleteWorkspaceCredentials(
		r.Context(), chID, session.Email,
	)

	// Best-effort revoke. Revocation failure does NOT roll back the delete
	// — the customer wants the credential gone from our side regardless,
	// and a stale token at Google will rotate out on its own. Log it.
	revoked := false
	if refreshToken != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		if err := revokeGoogleRefreshToken(ctx, refreshToken); err != nil {
			s.log.Printf("workspace revoke failed for channel=%s operator=%s: %v",
				chID, session.Email, err)
		} else {
			revoked = true
		}
		cancel()
	}

	outcome := "ok"
	detail := ""
	statusCode := http.StatusOK
	switch {
	case errors.Is(delErr, ErrUnknownTenant):
		outcome = "denied"
		detail = delErr.Error()
		statusCode = http.StatusNotFound
	case errors.Is(delErr, ErrUnknownOperator):
		outcome = "denied"
		detail = delErr.Error()
		statusCode = http.StatusForbidden
	case delErr != nil:
		outcome = "failed"
		detail = delErr.Error()
		statusCode = http.StatusInternalServerError
	}

	auditErr := s.store.AppendWorkspaceAuditEvent(r.Context(), WorkspaceAuditEvent{
		Event:     "workspace.disconnect.completed",
		TenantID:  chID,
		Operator:  session.Email,
		Slot:      slot,
		Namespace: ns,
		Outcome:   outcome,
		Detail:    detail,
	})
	if auditErr != nil {
		s.log.Printf("workspace audit append failed: %v", auditErr)
	}

	if delErr != nil {
		s.log.Printf("workspace delete failed for channel=%s operator=%s: %v",
			chID, session.Email, delErr)
		http.Error(w, outcome, statusCode)
		return
	}
	writeJSON(w, http.StatusOK, portalWorkspaceDisconnectFinishResponse{
		OK:        true,
		Namespace: ns,
		Slot:      slot,
		Revoked:   revoked,
	})
}

// revokeGoogleRefreshToken posts the token to Google's OAuth revoke
// endpoint per RFC 7009. Returns nil on 200, an error otherwise. Google
// returns 400 invalid_token for already-revoked tokens — caller can
// treat that as "effectively revoked" if they want; the current call
// site logs and moves on regardless.
func revokeGoogleRefreshToken(ctx context.Context, refreshToken string) error {
	body := url.Values{"token": {refreshToken}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleRevokeEndpoint,
		strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("revoke endpoint returned " + resp.Status)
	}
	return nil
}

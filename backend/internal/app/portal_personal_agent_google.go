package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Personal-agent Google Workspace connect/disconnect/status.
//
// The OAuth 2.1 + DCR consent dance runs in the Next.js portal (mirrors the
// channel workspace flow in portal_workspace_connect.go — the frontend does
// discovery → /register → /authorize → /token and ends holding the DCR
// client_id/client_secret + refresh_token bound to the OWNER's own Google
// account). These handlers receive the captured credentials, write the
// per-owner Secret + sidecar RBAC, and roll the PA pod so its in-pod
// gws-mcp-token-sidecar boots with them.
//
// All three are gated on a PortalTenantTypeUser session (the /me login),
// resolved to the target agent via ownerPersonalAgentForRequest (selects by
// agentId + validates ownership, #651) — same ownership check as the icon
// handlers.

type personalAgentGoogleConnectRequest struct {
	DCR struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	} `json:"dcr"`
	RefreshToken string `json:"refreshToken"`
	Email        string `json:"email"` // the connected Google account
	Scope        string `json:"scope"`
}

type personalAgentGoogleStatusResponse struct {
	Connected bool   `json:"connected"`
	Email     string `json:"email,omitempty"`
}

// resolvePersonalAgentOwner authenticates the /me session and returns the
// target agent the caller owns. Delegates to the shared
// ownerPersonalAgentForRequest resolver, which selects the agent by `agentId`
// (query for GETs, body for writes) and validates ownership (#651). On success
// the second return is http.StatusOK; on error it is the status the caller
// should write.
func (s *Server) resolvePersonalAgentOwner(r *http.Request) (PersonalAgentRecord, int, error) {
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		return PersonalAgentRecord{}, status, err
	}
	return rec, http.StatusOK, nil
}

// redeployPersonalAgentGoogle re-writes the agent Deployment to attach or
// detach the Google sidecar. The credential Secret + RBAC must already be
// written (connect) or this just rebuilds without the sidecar (disconnect).
func (s *Server) redeployPersonalAgentGoogle(ctx context.Context, rec PersonalAgentRecord, connected bool, email string) error {
	if err := s.personalAgent.WriteAgentDeployment(ctx, PersonalAgentDeploymentRequest{
		SlackUserID:              rec.OwnerSlackUserID,
		OwnerSlackUserID:         rec.OwnerSlackUserID,
		DisplayName:              rec.DisplayName,
		AgentID:                  rec.ID,
		Image:                    s.cfg.PersonalAgentImage,
		GoogleWorkspaceConnected: connected,
		GoogleEmail:              email,
	}); err != nil {
		return err
	}
	// On connect, force a fresh pod so the sidecar reloads the just-written
	// bootstrap token. WriteAgentDeployment is a no-op when the owner was
	// already connected (re-consent / scope change), and the sidecar only
	// re-reads the bootstrap Secret on a clean pod — without this, a re-consent
	// silently keeps minting the old token. (Disconnect already rolls the pod
	// via the spec change that removes the sidecar.)
	if connected {
		if err := s.personalAgent.RestartAgentDeployment(ctx, rec.ID); err != nil {
			return err
		}
	}
	return nil
}

// handlePersonalAgentGoogleConnectFinish receives the DCR client + refresh
// token captured by the portal consent dance, writes the per-owner Secret +
// sidecar RBAC, and rolls the pod so the sidecar boots connected.
func (s *Server) handlePersonalAgentGoogleConnectFinish(w http.ResponseWriter, r *http.Request) {
	if s.personalAgent.Disabled() {
		http.Error(w, "personal agents not configured", http.StatusServiceUnavailable)
		return
	}
	rec, code, err := s.resolvePersonalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}

	var req personalAgentGoogleConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	clientID := strings.TrimSpace(req.DCR.ClientID)
	clientSecret := strings.TrimSpace(req.DCR.ClientSecret)
	refreshToken := strings.TrimSpace(req.RefreshToken)
	// Same minimum-length sanity check as the channel workspace flow: gateway
	// DCR client_id ~40 chars, client_secret ~60, refresh_token ~640.
	if len(clientID) < 16 || len(clientSecret) < 16 || len(refreshToken) < 64 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if err := s.personalAgent.WriteGoogleCredentials(
		r.Context(), rec.ID, req.Email, clientID, clientSecret, refreshToken,
	); err != nil {
		s.log.Printf("personal-agent google connect write failed for owner=%s: %v", rec.OwnerSlackUserID, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	// Roll the pod so the sidecar attaches. The Secret + RBAC are already
	// written (WriteGoogleCredentials ensures RBAC before the Secret), so the
	// pod's per-owner ServiceAccount reference resolves at admission.
	if err := s.redeployPersonalAgentGoogle(r.Context(), rec, true, strings.TrimSpace(req.Email)); err != nil {
		s.log.Printf("personal-agent google connect redeploy failed for owner=%s: %v", rec.OwnerSlackUserID, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, personalAgentGoogleStatusResponse{
		Connected: true,
		Email:     strings.ToLower(strings.TrimSpace(req.Email)),
	})
}

// handlePersonalAgentGoogleDisconnect deletes the per-owner Secret + RBAC,
// best-effort revokes the refresh token, and rolls the pod without the
// sidecar.
func (s *Server) handlePersonalAgentGoogleDisconnect(w http.ResponseWriter, r *http.Request) {
	if s.personalAgent.Disabled() {
		http.Error(w, "personal agents not configured", http.StatusServiceUnavailable)
		return
	}
	rec, code, err := s.resolvePersonalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}

	refreshToken, delErr := s.personalAgent.DeleteGoogleCredentials(r.Context(), rec.ID)
	if delErr != nil {
		s.log.Printf("personal-agent google disconnect delete failed for owner=%s: %v", rec.OwnerSlackUserID, delErr)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}

	// Best-effort revoke. Failure never rolls back the delete — the owner
	// wants the credential gone from our side regardless, and a stale token
	// rotates out on its own. (The token is the gateway's session refresh
	// token; revoke is opportunistic.)
	revoked := false
	if refreshToken != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		if err := revokeGoogleRefreshToken(ctx, refreshToken); err != nil {
			s.log.Printf("personal-agent google revoke failed for owner=%s: %v", rec.OwnerSlackUserID, err)
		} else {
			revoked = true
		}
		cancel()
	}

	// Roll the pod without the sidecar.
	if err := s.redeployPersonalAgentGoogle(r.Context(), rec, false, ""); err != nil {
		s.log.Printf("personal-agent google disconnect redeploy failed for owner=%s: %v", rec.OwnerSlackUserID, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK      bool `json:"ok"`
		Revoked bool `json:"revoked"`
	}{OK: true, Revoked: revoked})
}

// handlePersonalAgentGoogleStatus reports whether the owner has connected
// Google + which account, for the /me connections panel.
func (s *Server) handlePersonalAgentGoogleStatus(w http.ResponseWriter, r *http.Request) {
	if s.personalAgent.Disabled() {
		writeJSON(w, http.StatusOK, personalAgentGoogleStatusResponse{Connected: false})
		return
	}
	rec, code, err := s.resolvePersonalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), code)
		return
	}
	// Connected-ness is the existence of the per-owner OAuth Secret, NOT the
	// presence of an email. The email annotation can be empty (the gateway's
	// /token doesn't always return a Google id_token to extract it from), but
	// the connection — and the sidecar — are live regardless. Keying off email
	// left the /me chip white after a successful connect.
	connected, err := s.personalAgent.HasGoogleCredentials(r.Context(), rec.ID)
	if err != nil {
		s.log.Printf("personal-agent google status read failed for owner=%s: %v", rec.OwnerSlackUserID, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	email, _ := s.personalAgent.ReadGoogleEmail(r.Context(), rec.ID) // cosmetic; best-effort
	writeJSON(w, http.StatusOK, personalAgentGoogleStatusResponse{
		Connected: connected,
		Email:     email,
	})
}

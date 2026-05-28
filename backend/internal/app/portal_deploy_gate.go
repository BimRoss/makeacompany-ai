package app

import (
	"net/http"
)

// handleInternalDeployGateCheck is the Joanne-facing variant of the deploy gate.
// Joanne has a user's Slack user ID but no portal session, so this endpoint
// accepts the BACKEND_INTERNAL_SERVICE_TOKEN bearer and a slack_user_id query param.
//
// GET /v1/internal/deploy-gate?slack_user_id=U...
func (s *Server) handleInternalDeployGateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID := r.URL.Query().Get("slack_user_id")
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	email, _, err := s.store.UserProfileTierBySlackUser(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("internal deploy gate slack lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to resolve user"})
		return
	}
	if email == "" {
		// Unknown Slack user — treat as free tier not yet consumed (safe default).
		status := CheckDeployGate(UserProfileRow{}, s.cfg.FreeTierGateEnabled)
		writeJSON(w, http.StatusOK, gateJSON(status, s.cfg.AppBaseURL))
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), email)
	if err != nil {
		s.log.Printf("internal deploy gate profile: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	status := CheckDeployGate(row, s.cfg.FreeTierGateEnabled)
	writeJSON(w, http.StatusOK, gateJSON(status, s.cfg.AppBaseURL))
}

// handleInternalDeployGateConsume is the Joanne-facing variant of the consume endpoint.
//
// POST /v1/internal/deploy-gate/consume?slack_user_id=U...
func (s *Server) handleInternalDeployGateConsume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID := r.URL.Query().Get("slack_user_id")
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	email, _, err := s.store.UserProfileTierBySlackUser(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("internal deploy gate consume slack lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to resolve user"})
		return
	}
	if email == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "consumed": false, "note": "unknown slack user"})
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), email)
	if err != nil {
		s.log.Printf("internal deploy gate consume profile: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	status := CheckDeployGate(row, s.cfg.FreeTierGateEnabled)
	if status.Reason == "paid" || status.Reason == "gate_disabled" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "consumed": false})
		return
	}
	if err := s.store.SetFreeTierConsumed(r.Context(), email); err != nil {
		s.log.Printf("internal deploy gate consume set: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to record consumption"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "consumed": true})
}

// gateJSON builds the JSON response body for deploy gate endpoints.
func gateJSON(s DeployGateStatus, appBaseURL string) map[string]any {
	out := map[string]any{
		"allowed": s.Allowed,
		"reason":  s.Reason,
	}
	if !s.Allowed {
		out["checkoutURL"] = appBaseURL + "/billing"
	}
	return out
}

// handlePortalDeployGate returns whether the authenticated user may ship a deployment.
// Joanne calls this before executing a Cloudflare Pages publish or rancher-admin gitops push.
//
// GET /v1/portal/deploy-gate
//
// Response:
//
//	{ "allowed": true,  "reason": "paid" | "free_tier_available" | "gate_disabled" }
//	{ "allowed": false, "reason": "free_tier_consumed", "checkoutURL": "<billing page>" }
func (s *Server) handlePortalDeployGateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("deploy gate profile lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	writeJSON(w, http.StatusOK, gateJSON(CheckDeployGate(row, s.cfg.FreeTierGateEnabled), s.cfg.AppBaseURL))
}

// handlePortalDeployGateConsume marks the authenticated user's free deploy allotment as consumed.
// Joanne calls this after a deploy action completes successfully for a free user.
//
// POST /v1/portal/deploy-gate/consume
//
// Response: { "ok": true }
func (s *Server) handlePortalDeployGateConsume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Only consume for free users — paid users are unaffected.
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("deploy gate consume profile lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	status := CheckDeployGate(row, s.cfg.FreeTierGateEnabled)
	if status.Reason == "paid" || status.Reason == "gate_disabled" {
		// Paid users have no free tier to consume; gate disabled means nothing to track.
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "consumed": false})
		return
	}
	if err := s.store.SetFreeTierConsumed(r.Context(), session.Email); err != nil {
		s.log.Printf("deploy gate consume set: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to record consumption"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "consumed": true})
}

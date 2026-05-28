package app

import (
	"net/http"
)

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
	status := CheckDeployGate(row, s.cfg.FreeTierGateEnabled)
	out := map[string]any{
		"allowed": status.Allowed,
		"reason":  status.Reason,
	}
	if !status.Allowed {
		// Point the caller at the billing page — same path the portal billing cancel flow uses.
		out["checkoutURL"] = s.cfg.AppBaseURL + "/billing"
	}
	writeJSON(w, http.StatusOK, out)
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

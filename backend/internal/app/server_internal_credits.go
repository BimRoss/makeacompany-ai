package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// Credit metering internal endpoints (#797). The harness is the only caller:
// it admission-checks at spawn start and, once a spawn does real work, records
// one credit at its reply gate. Both are bearer-gated with the master internal
// service token, same as the deploy-gate endpoints they mirror.
//
// Identity is a Slack user id resolved to the profile email via the slack->email
// index. A Slack user with no profile yet (unlinked, mid-onboarding) is treated
// as un-metered: we can't key a balance without an email, and fail-open is the
// safe default for launch. Those users start being metered the moment they have
// a profile. Flagged in #797 as a v1 decision.

// handleInternalCreditsCheck reports whether a user may spawn real work.
//
// GET /v1/internal/credits?slack_user_id=U...
//
//	{ "allowed": true,  "balance": 87, "unlimited": false, "reason": "ok" }
//	{ "allowed": true,  "balance": 0,  "unlimited": true,  "reason": "unlimited" }
//	{ "allowed": true,  "reason": "unknown_user" }                 // no profile yet
//	{ "allowed": true,  "reason": "gate_disabled" }                // CREDIT_GATE_ENABLED=false
//	{ "allowed": false, "balance": 0,  "reason": "no_credits", "checkoutURL": "<billing>" }
func (s *Server) handleInternalCreditsCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID := strings.TrimSpace(r.URL.Query().Get("slack_user_id"))
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	email, _, err := s.store.UserProfileTierBySlackUser(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("internal credits check slack lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to resolve user"})
		return
	}
	if email == "" {
		// No profile: can't meter, fail open.
		writeJSON(w, http.StatusOK, map[string]any{"allowed": true, "reason": "unknown_user"})
		return
	}
	bal, err := s.store.GetCredits(r.Context(), email, s.cfg.CreditInitialGrant)
	if err != nil {
		s.log.Printf("internal credits check balance: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to read balance"})
		return
	}
	if bal.Unlimited {
		writeJSON(w, http.StatusOK, map[string]any{"allowed": true, "unlimited": true, "reason": "unlimited"})
		return
	}
	// Gate off: report the balance for observability but never block.
	if !s.cfg.CreditGateEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"allowed": true, "balance": bal.Balance, "reason": "gate_disabled"})
		return
	}
	if bal.Balance <= 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"allowed":     false,
			"balance":     bal.Balance,
			"reason":      "no_credits",
			"checkoutURL": s.cfg.AppBaseURL + "/billing",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"allowed": true, "balance": bal.Balance, "reason": "ok"})
}

// internalCreditsConsumeRequest is the JSON body for a consume. slack_user_id may
// also be passed as a query param (matching the deploy-gate style); the body wins
// when both are present. n defaults to 1. idempotency_key dedupes retries.
type internalCreditsConsumeRequest struct {
	SlackUserID    string `json:"slack_user_id"`
	N              int    `json:"n"`
	IdempotencyKey string `json:"idempotency_key"`
	SlackTeamID    string `json:"slack_team_id"`
}

// handleInternalCreditsConsume records one (or n) credits spent on a real-work
// spawn. It always records when called, gate on or off: the meter should reflect
// true usage from day one so we have data before the paywall flips live.
//
// POST /v1/internal/credits/consume
//
//	{ "ok": true, "charged": true,  "balance": 86 }
//	{ "ok": true, "charged": false, "balance": 0, "reason": "insufficient" }
//	{ "ok": true, "charged": false, "reason": "unlimited" }
//	{ "ok": true, "charged": false, "reason": "duplicate" }
//	{ "ok": true, "charged": false, "reason": "unknown_user" }
func (s *Server) handleInternalCreditsConsume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req internalCreditsConsumeRequest
	if r.Body != nil {
		// A malformed body is a client error; an empty body falls back to query params.
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && err.Error() != "EOF" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
	}
	slackUserID := strings.TrimSpace(req.SlackUserID)
	if slackUserID == "" {
		slackUserID = strings.TrimSpace(r.URL.Query().Get("slack_user_id"))
	}
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slack_user_id required"})
		return
	}
	email, _, err := s.store.UserProfileTierBySlackUser(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("internal credits consume slack lookup: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to resolve user"})
		return
	}
	if email == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "charged": false, "reason": "unknown_user"})
		return
	}
	// Best-effort provenance capture; never blocks the consume.
	if team := strings.TrimSpace(req.SlackTeamID); team != "" {
		if err := s.store.SetSlackTeamID(r.Context(), email, team); err != nil {
			s.log.Printf("internal credits consume team stamp: %v", err)
		}
	}
	outcome, balance, err := s.store.ConsumeCredits(r.Context(), email, req.N, req.IdempotencyKey, s.cfg.CreditInitialGrant)
	if err != nil {
		s.log.Printf("internal credits consume: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to record consumption"})
		return
	}
	out := map[string]any{"ok": true, "charged": outcome == ConsumeCharged}
	if outcome == ConsumeUnlimited {
		out["reason"] = ConsumeUnlimited
	} else {
		out["balance"] = balance
		if outcome != ConsumeCharged {
			out["reason"] = outcome
		}
	}
	writeJSON(w, http.StatusOK, out)
}

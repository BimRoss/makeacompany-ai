package app

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

// handleInternalTrialExpiryReaper scans user profiles for trials that just expired and pushes one
// "send the day-7 DM" job per user onto the Joanne queue. Idempotent via expiry_dm_enqueued_at.
//
// Bearer-gated like the other /v1/internal/* endpoints. Intended to run from a Kubernetes CronJob
// (rancher-admin follow-up) every few minutes.
//
// POST /v1/internal/trial-expiry-reaper
//
// Response: { "ok": true, "scanned": N, "enqueued": M, "checkoutUrl": "<...>" }
func (s *Server) handleInternalTrialExpiryReaper(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	now := time.Now().UTC()
	candidates, err := s.store.ScanTrialExpiredUnenqueued(r.Context(), now)
	if err != nil {
		s.log.Printf("trial-expiry reaper scan: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "scan failed"})
		return
	}
	checkoutURL := s.trialExpiryCheckoutURL()
	enqueued := 0
	for _, row := range candidates {
		// Skip rows missing a Slack id — Joanne can't DM what she can't address.
		slackID := strings.TrimSpace(row.SlackUserID)
		if slackID == "" {
			continue
		}
		job := ExpiryDMJob{
			SlackUserID:       slackID,
			Email:             row.Email,
			StripeCheckoutURL: appendClientReferenceID(checkoutURL, slackID),
		}
		if err := s.store.EnqueueExpiryDMJob(r.Context(), row.Email, job); err != nil {
			s.log.Printf("trial-expiry reaper enqueue %s: %v", row.Email, err)
			continue
		}
		enqueued++
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"scanned":     len(candidates),
		"enqueued":    enqueued,
		"checkoutUrl": checkoutURL,
	})
}

// trialExpiryCheckoutURL returns the link substituted into the Joanne expiry DM. Prefers the
// configured TRIAL_EXPIRY_CHECKOUT_URL (typically a Stripe Payment Link); otherwise falls back
// to the lander pricing CTA so the cron still produces a usable link in dev.
func (s *Server) trialExpiryCheckoutURL() string {
	if u := strings.TrimSpace(s.cfg.TrialExpiryCheckoutURL); u != "" {
		return u
	}
	return strings.TrimRight(s.cfg.AppBaseURL, "/") + "/?checkout=base_plan"
}

// appendClientReferenceID adds ?client_reference_id=<slackID> to the checkout URL so the Stripe
// webhook (#242) can map the payment back to the Slack profile. Preserves any existing query
// string. If the URL fails to parse, falls back to the input unchanged — the DM is still useful,
// the operator just has to reconcile by hand.
func appendClientReferenceID(rawURL, slackID string) string {
	if rawURL == "" || slackID == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := u.Query()
	q.Set("client_reference_id", slackID)
	u.RawQuery = q.Encode()
	return u.String()
}

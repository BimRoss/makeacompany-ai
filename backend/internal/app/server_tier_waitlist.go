package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// tierWaitlistNotifyTo is who gets the Resend "new tier-waitlist signup" alert.
// John is the sales touchpoint; flip via env if it ever needs to fan out.
const tierWaitlistDefaultNotifyTo = "John@makeacompany.ai"

type tierWaitlistRequest struct {
	Tier  string `json:"tier"`
	Email string `json:"email"`
}

// handleTierWaitlist accepts a public POST {tier, email}. Persists to Redis
// and (best-effort) sends a Resend alert to John. Persistence is the source
// of truth — Resend failures are logged but don't fail the request.
func (s *Server) handleTierWaitlist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4*1024))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "body too large or unreadable"})
		return
	}
	var req tierWaitlistRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json: " + err.Error()})
			return
		}
	}
	tier := strings.TrimSpace(strings.ToLower(req.Tier))
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "valid email required"})
		return
	}

	source := "lander-pricing-tier-" + tier
	if err := s.store.SaveTierWaitlistSignup(r.Context(), tier, email, source); err != nil {
		if errors.Is(err, ErrTierWaitlistInvalidTier) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid tier"})
			return
		}
		s.log.Printf("tier-waitlist save: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "save failed"})
		return
	}

	go s.notifyTierWaitlistSignup(tier, email)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// notifyTierWaitlistSignup forwards the signup via Resend to John. Runs in
// a goroutine so a slow Resend doesn't block the response. Best-effort: we
// log but don't escalate failures (the Redis entry is the truth).
func (s *Server) notifyTierWaitlistSignup(tier, email string) {
	apiKey := strings.TrimSpace(s.cfg.ResendAPIKey)
	from := strings.TrimSpace(s.cfg.PortalAuthEmailFrom)
	if apiKey == "" || from == "" {
		s.log.Printf("tier-waitlist notify skipped: resend not configured (tier=%s email=%s)", tier, email)
		return
	}
	to := tierWaitlistDefaultNotifyTo
	subject := fmt.Sprintf("New %s waitlist signup: %s", tier, email)
	plain := fmt.Sprintf("New %s waitlist signup.\n\nEmail: %s\nTier:  %s\n\nFull list: /admin (tier-waitlist panel).\n", tier, email, tier)
	html := fmt.Sprintf(
		`<p>New <strong>%s</strong> waitlist signup.</p><p><strong>Email:</strong> %s<br/><strong>Tier:</strong> %s</p><p>Full list in /admin under the tier-waitlist panel.</p>`,
		htmlEscape(tier), htmlEscape(email), htmlEscape(tier),
	)
	if err := sendEmailViaResend(apiKey, from, to, subject, plain, html); err != nil {
		s.log.Printf("tier-waitlist notify resend failed (tier=%s email=%s): %v", tier, email, err)
	}
}

// htmlEscape avoids pulling in html/template for one-off interpolation.
func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

// handleAdminTierWaitlist returns the list of signups for the /admin panel.
// Optional ?tier= filter. Auth: admin session (same as the other admin reads).
func (s *Server) handleAdminTierWaitlist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	tok := tokenFromAuthHeader(r)
	if _, err := s.validateAdminSession(r.Context(), tok); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tier := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("tier")))
	list, err := s.store.ListTierWaitlistSignups(r.Context(), tier)
	if err != nil {
		if errors.Is(err, ErrTierWaitlistInvalidTier) {
			http.Error(w, "invalid tier", http.StatusBadRequest)
			return
		}
		s.log.Printf("tier-waitlist list: %v", err)
		http.Error(w, "list error", http.StatusInternalServerError)
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"signups": list})
}

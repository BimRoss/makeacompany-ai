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

	go func() {
		// Internal alert to the sales touchpoint (John).
		s.notifyTierWaitlistSignup(tier, email)
		// Personal welcome back to whoever just submitted.
		s.sendTierWaitlistWelcome(tier, email)
	}()

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
	tierLabel := prettyTierLabel(tier)
	subject := fmt.Sprintf("New %s waitlist signup: %s", tierLabel, email)
	plain := fmt.Sprintf("New %s waitlist signup.\n\nEmail: %s\nTier:  %s\n\nFull list: https://makeacompany.ai/admin (tier-waitlist panel).\n", tierLabel, email, tierLabel)
	html := renderTierWaitlistEmailHTML(tierLabel, email)
	if err := sendEmailViaResend(apiKey, from, to, subject, plain, html); err != nil {
		s.log.Printf("tier-waitlist notify resend failed (tier=%s email=%s): %v", tier, email, err)
	}
}

// sendTierWaitlistWelcome sends a personal welcome to the submitter, from John,
// so the person who just filled the form actually hears back from us. Best-effort:
// runs in the same goroutine as the internal alert and only logs on failure (the
// Redis entry is the source of truth). Reply-To routes responses to John's inbox.
func (s *Server) sendTierWaitlistWelcome(tier, email string) {
	apiKey := strings.TrimSpace(s.cfg.ResendAPIKey)
	from := strings.TrimSpace(s.cfg.MarketingWelcomeEmailFrom)
	if apiKey == "" || from == "" {
		s.log.Printf("tier-waitlist welcome skipped: resend/from not configured (tier=%s email=%s)", tier, email)
		return
	}
	replyTo := strings.TrimSpace(s.cfg.MarketingWelcomeReplyTo)
	subject := "Thanks for reaching out to MakeaCompany"
	plain := tierWaitlistWelcomePlain()
	html := renderTierWaitlistWelcomeHTML()
	if err := sendEmailViaResendReplyTo(apiKey, from, email, subject, plain, html, replyTo); err != nil {
		s.log.Printf("tier-waitlist welcome resend failed (tier=%s email=%s): %v", tier, email, err)
	}
}

// tierWaitlistWelcomePlain is the plain-text body of the welcome email. Kept in
// John's voice: warm, grateful, and pointed at learning what they're building.
func tierWaitlistWelcomePlain() string {
	return strings.Join([]string{
		"Hi,",
		"",
		"Thanks for reaching out on MakeaCompany. Genuinely glad you're here.",
		"",
		"I'm John. I run growth and partnerships, and I read every one of these myself.",
		"",
		"I'd love to learn what you're building so I can actually be useful. A few things that help:",
		"",
		"  - What are you working on, or what company are you with?",
		"  - What would you hand an agent team first?",
		"  - Where's the friction right now?",
		"",
		"Even a line or two is plenty. Just reply straight to this email, it comes to me.",
		"",
		"Talk soon,",
		"John",
		"john@makeacompany.ai",
		"makeacompany.ai",
	}, "\n")
}

// renderTierWaitlistWelcomeHTML is the branded HTML twin of the plain welcome,
// matching the house style of the internal alert. Inline styles only.
func renderTierWaitlistWelcomeHTML() string {
	const tmpl = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thanks for reaching out</title>
</head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ef;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 8px 24px rgba(0,0,0,0.06);overflow:hidden;">
<tr><td style="padding:36px 40px 8px 40px;">
<div style="font-size:13px;letter-spacing:0.18em;color:#9c9a96;text-transform:uppercase;font-weight:600;">MAKEACOMPANY.AI</div>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:#1d1d1f;">Thanks for reaching out</h1>
</td></tr>
<tr><td style="padding:18px 40px 0 40px;">
<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#3d3d3f;">Genuinely glad you're here. I'm John. I run growth and partnerships, and I read every one of these myself.</p>
<p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;color:#3d3d3f;">I'd love to learn what you're building so I can actually be useful. A few things that help:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9f7f3;border:1px solid #eeece8;border-radius:10px;margin:4px 0 8px 0;">
<tr><td style="padding:16px 20px;font-size:15px;line-height:1.7;color:#1d1d1f;">
&bull;&nbsp; What are you working on, or what company are you with?<br>
&bull;&nbsp; What would you hand an agent team first?<br>
&bull;&nbsp; Where's the friction right now?
</td></tr>
</table>
<p style="margin:16px 0 0 0;font-size:16px;line-height:1.6;color:#3d3d3f;">Even a line or two is plenty. Just reply straight to this email, it comes to me.</p>
</td></tr>
<tr><td style="padding:24px 40px 32px 40px;">
<p style="margin:0;font-size:16px;line-height:1.6;color:#1d1d1f;">Talk soon,<br><strong>John</strong><br>
<a href="mailto:john@makeacompany.ai" style="color:#1d1d1f;text-decoration:none;">john@makeacompany.ai</a></p>
</td></tr>
<tr><td style="border-top:1px solid #eeece8;padding:20px 40px;">
<div style="font-size:12px;color:#9c9a96;text-align:center;">
<a href="https://makeacompany.ai" style="color:#9c9a96;text-decoration:none;font-weight:600;letter-spacing:0.04em;">makeacompany.ai</a>
</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
	return tmpl
}

// prettyTierLabel turns an allowlisted tier slug into a display label
// ("personal-agent" -> "Personal Agent"). Falls back to title-casing any
// future slug so a missing case still renders sensibly.
func prettyTierLabel(tier string) string {
	switch tier {
	case "personal-agent":
		return "Personal Agent"
	case "enterprise":
		return "Enterprise"
	}
	parts := strings.Split(tier, "-")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

// renderTierWaitlistEmailHTML returns the branded MakeaCompany alert sent
// to the sales touchpoint on every signup. Inline styles only — most
// email clients strip <style> blocks.
func renderTierWaitlistEmailHTML(tierLabel, email string) string {
	const tmpl = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>New waitlist signup</title>
</head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ef;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%%;background:#ffffff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 8px 24px rgba(0,0,0,0.06);overflow:hidden;">
<tr><td style="padding:36px 40px 8px 40px;">
<div style="font-size:13px;letter-spacing:0.18em;color:#9c9a96;text-transform:uppercase;font-weight:600;">MAKEACOMPANY.AI</div>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
<h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:700;color:#1d1d1f;">New waitlist signup</h1>
<p style="margin:12px 0 0 0;font-size:16px;line-height:1.55;color:#3d3d3f;">Someone just dropped their email on the pricing page. Details below.</p>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#f9f7f3;border:1px solid #eeece8;border-radius:10px;">
<tr><td style="padding:18px 20px;">
<div style="font-size:12px;letter-spacing:0.12em;color:#9c9a96;text-transform:uppercase;font-weight:600;">Email</div>
<div style="font-size:17px;line-height:1.4;color:#1d1d1f;font-weight:600;margin-top:4px;word-break:break-all;"><a href="mailto:%[1]s" style="color:#1d1d1f;text-decoration:none;">%[1]s</a></div>
</td></tr>
<tr><td style="padding:0 20px 18px 20px;">
<div style="border-top:1px solid #eeece8;padding-top:14px;">
<div style="font-size:12px;letter-spacing:0.12em;color:#9c9a96;text-transform:uppercase;font-weight:600;">Tier</div>
<div style="font-size:17px;line-height:1.4;color:#1d1d1f;font-weight:600;margin-top:4px;">%[2]s</div>
</div>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:28px 40px 8px 40px;">
<a href="https://makeacompany.ai/admin" style="display:inline-block;background:#000000;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:10px;">Open /admin →</a>
</td></tr>
<tr><td style="padding:18px 40px 32px 40px;">
<p style="margin:0;font-size:13px;line-height:1.5;color:#8c8a86;text-align:center;">Full list lives under the tier-waitlist panel.</p>
</td></tr>
<tr><td style="border-top:1px solid #eeece8;padding:20px 40px;">
<div style="font-size:12px;color:#9c9a96;text-align:center;">
<a href="https://makeacompany.ai" style="color:#9c9a96;text-decoration:none;font-weight:600;letter-spacing:0.04em;">makeacompany.ai</a>
</div>
</td></tr>
</table>
<div style="margin-top:14px;font-size:12px;color:#a8a6a2;">Sent by the pricing page on makeacompany.ai</div>
</td></tr>
</table>
</body>
</html>`
	return fmt.Sprintf(tmpl, htmlEscape(email), htmlEscape(tierLabel))
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

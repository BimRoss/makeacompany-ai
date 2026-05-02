package app

import (
	"context"
	"fmt"
	"strings"
)

const checkoutInviteURL = "https://join.slack.com/t/bimrossllc/shared_invite/zt-3wux8vlv8-3OlZ8G4DGo0VNMiVpNoTPA"

func fallbackFirstNameFromEmail(email string) string {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return "there"
	}
	local := email
	if i := strings.Index(local, "@"); i >= 0 {
		local = local[:i]
	}
	local = strings.ReplaceAll(local, ".", " ")
	local = strings.ReplaceAll(local, "_", " ")
	local = strings.ReplaceAll(local, "-", " ")
	local = strings.TrimSpace(local)
	if local == "" {
		return "there"
	}
	return strings.ToUpper(local[:1]) + local[1:]
}

// checkoutWelcomeResendTemplateVariables extends magic-link keys (login_url, recipient_first_name) with assets for the welcome-email template.
// Bind Joanne's portrait in Resend as e.g. <img src="{{joanne_headshot_url}}" alt="Joanne" width="64" height="64" style="border-radius:9999px" />.
func checkoutWelcomeResendTemplateVariables(cfg Config, slackInviteURL, firstName string) map[string]string {
	vars := resendMagicLinkTemplateVariables(cfg, slackInviteURL, firstName)
	base := strings.TrimRight(strings.TrimSpace(cfg.AppBaseURL), "/")
	if base != "" {
		vars["joanne_headshot_url"] = base + "/headshots/joanne.png"
	}
	return vars
}

// sendCheckoutWelcomeInviteEmail sends one Joanne-style invite email per checkout session.
// This is best-effort and never blocks successful checkout registration persistence.
func (s *Server) sendCheckoutWelcomeInviteEmail(ctx context.Context, sessionID, email string) error {
	if strings.TrimSpace(s.cfg.ResendAPIKey) == "" || strings.TrimSpace(s.cfg.PortalAuthEmailFrom) == "" {
		return nil
	}
	ok, err := s.store.TryMarkCheckoutWelcomeInviteEmailSent(ctx, sessionID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}

	first := strings.TrimSpace(s.store.LookupSlackFirstNameByEmail(ctx, email))
	if first == "" {
		first = fallbackFirstNameFromEmail(email)
	}
	to := strings.TrimSpace(email)
	if tid := strings.TrimSpace(s.cfg.ResendCheckoutWelcomeTemplateID); tid != "" {
		// Empty subject: use template subject from Resend. Slack invite URL is passed as the same link key as magic-link templates (default login_url).
		return sendEmailViaResendTemplate(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, to, "", tid, checkoutWelcomeResendTemplateVariables(s.cfg, checkoutInviteURL, first))
	}
	subject := "Welcome to MakeACompany!"
	paragraph := fmt.Sprintf("Welcome to MakeACompany, %s! We're excited to have you here and ready to start building with your AI-native company workspace.", first)
	plain := paragraph + "\n\nJoin our Company: " + checkoutInviteURL + "\n"
	html := fmt.Sprintf(
		`<p>%s</p><p><a href="%s" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-weight:600;">Join our Company</a></p>`,
		paragraph,
		checkoutInviteURL,
	)
	return sendEmailViaResend(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, to, subject, plain, html)
}

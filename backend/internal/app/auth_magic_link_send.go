package app

import (
	"context"
	"fmt"
	"strings"
)

// sendChannelUserStyleMagicLinkEmail sends the same Resend template (or inline fallback)
// as portal /{channelId}/login. Admin magic links use this too — only signInURL differs
// (portal vs admin callback); allowlist is enforced separately before calling.
func (s *Server) sendChannelUserStyleMagicLinkEmail(ctx context.Context, email, signInURL string) error {
	subject := "Your company portal sign-in link"
	plain := fmt.Sprintf("Open this link to sign in (expires in 30 minutes):\n\n%s\n", signInURL)
	html := fmt.Sprintf(`<p>Sign in to your company portal.</p><p><a href="%s">Continue to portal</a></p><p>This link expires in 30 minutes.</p>`, signInURL)
	first := s.store.LookupSlackFirstNameByEmail(ctx, email)
	if tid := strings.TrimSpace(s.cfg.ResendMagicLinkTemplateID); tid != "" {
		// Empty subject: Resend uses template subject + preview; non-empty subject overrides both.
		return sendEmailViaResendTemplate(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, email, "", tid, resendMagicLinkTemplateVariables(s.cfg, signInURL, first))
	}
	return sendEmailViaResend(s.cfg.ResendAPIKey, s.cfg.PortalAuthEmailFrom, email, subject, plain, html)
}

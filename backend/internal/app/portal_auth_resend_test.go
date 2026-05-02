package app

import "testing"

func TestResendMagicLinkTemplateVariables(t *testing.T) {
	m := resendMagicLinkTemplateVariables(Config{}, "https://app/cb?token=1", "Ada")
	if m["login_url"] != "https://app/cb?token=1" || m["recipient_first_name"] != "Ada" {
		t.Fatalf("defaults: %v", m)
	}
	m = resendMagicLinkTemplateVariables(Config{
		ResendMagicLinkTemplateLinkVar:      "MAGIC_LINK",
		ResendMagicLinkTemplateFirstNameVar: "who",
	}, "https://z", "  Pat ")
	if m["MAGIC_LINK"] != "https://z" || m["who"] != "Pat" {
		t.Fatalf("custom keys: %v", m)
	}
}

func TestCheckoutWelcomeResendTemplateVariables(t *testing.T) {
	m := checkoutWelcomeResendTemplateVariables(Config{AppBaseURL: "https://makeacompany.ai"}, "https://slack-invite", "Ada")
	if m["login_url"] != "https://slack-invite" || m["recipient_first_name"] != "Ada" {
		t.Fatalf("inherited magic-link vars: %v", m)
	}
	if m["joanne_headshot_url"] != "https://makeacompany.ai/headshots/joanne.png" {
		t.Fatalf("joanne_headshot_url: %q", m["joanne_headshot_url"])
	}
	m = checkoutWelcomeResendTemplateVariables(Config{}, "https://slack-invite", "Ada")
	if _, ok := m["joanne_headshot_url"]; ok {
		t.Fatalf("expected no joanne_headshot_url when AppBaseURL empty: %v", m)
	}
}

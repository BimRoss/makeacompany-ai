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

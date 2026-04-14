package app

import "testing"

func TestNormalizeCompanyChannel(t *testing.T) {
	e := normalizeCompanyChannel(CompanyChannel{
		CompanySlug: " acme ",
		ChannelID:   "",
		DisplayName: " Acme Co ",
	}, "C01234567")
	if e.ChannelID != "C01234567" || e.CompanySlug != "acme" || e.DisplayName != "Acme Co" {
		t.Fatalf("got %+v", e)
	}
}

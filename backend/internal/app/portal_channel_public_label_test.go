package app

import "testing"

func TestPortalDisplayLabelFromCompanyChannel(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		ch   CompanyChannel
		want string
	}{
		{
			"slug_hyphen",
			CompanyChannel{CompanySlug: "acme-corp", ChannelID: "C0ABC"},
			"Acme Corp",
		},
		{
			"slug_underscore",
			CompanyChannel{CompanySlug: "foo_bar_baz", ChannelID: "C0ABC"},
			"Foo Bar Baz",
		},
		{
			"display_when_no_slug",
			CompanyChannel{DisplayName: "##team", ChannelID: "C0ABC"},
			"team",
		},
		{
			"fallback_id",
			CompanyChannel{ChannelID: "C0XYZ99"},
			"C0XYZ99",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := portalDisplayLabelFromCompanyChannel(tc.ch)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

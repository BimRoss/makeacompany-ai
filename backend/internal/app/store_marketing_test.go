package app

import "testing"

func TestBuildMarketingTaggedURL(t *testing.T) {
	cases := []struct {
		name string
		in   MarketingCampaign
		want string
	}{
		{
			name: "bare url",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/", Source: "linkedin", Medium: "social", Campaign: "2026-06-veo-ad"},
			want: "https://makeacompany.ai/?utm_campaign=2026-06-veo-ad&utm_medium=social&utm_source=linkedin",
		},
		{
			name: "url with fragment — params go in query, not inside fragment",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/#pricing", Source: "linkedin", Medium: "social", Campaign: "c"},
			want: "https://makeacompany.ai/?utm_campaign=c&utm_medium=social&utm_source=linkedin#pricing",
		},
		{
			name: "url with trailing ? — no empty leading param",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/?", Source: "linkedin", Medium: "social", Campaign: "c"},
			want: "https://makeacompany.ai/?utm_campaign=c&utm_medium=social&utm_source=linkedin",
		},
		{
			name: "url with existing query — merges, does not duplicate",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/?ref=foo", Source: "linkedin", Medium: "social", Campaign: "c"},
			want: "https://makeacompany.ai/?ref=foo&utm_campaign=c&utm_medium=social&utm_source=linkedin",
		},
		{
			name: "content omitted when empty",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/", Source: "linkedin", Medium: "social", Campaign: "c", Content: ""},
			want: "https://makeacompany.ai/?utm_campaign=c&utm_medium=social&utm_source=linkedin",
		},
		{
			name: "content included when set",
			in:   MarketingCampaign{TargetURL: "https://makeacompany.ai/", Source: "linkedin", Medium: "social", Campaign: "c", Content: "hook"},
			want: "https://makeacompany.ai/?utm_campaign=c&utm_content=hook&utm_medium=social&utm_source=linkedin",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := BuildMarketingTaggedURL(tc.in)
			if got != tc.want {
				t.Errorf("BuildMarketingTaggedURL\n  got:  %s\n  want: %s", got, tc.want)
			}
		})
	}
}

package app

import "testing"

func TestValidInviteEmail(t *testing.T) {
	t.Parallel()
	cases := []struct {
		email string
		want  bool
	}{
		// Valid.
		{"jane@example.com", true},
		{"jane.doe+tag@sub.example.co.uk", true},
		{"user_name-1%x@example.io", true},

		// Invalid — the junk actually observed minting trial profiles in prod.
		{"{}afsdefaawe@gmail.com", false}, // literal braces in local part
		{"{}nantheesan@rexornge.site", false},

		// Invalid — structural.
		{"", false},
		{"noatsign.com", false},
		{"no@tld", false},
		{"two@@at.com", false},
		{"has space@example.com", false},
		{"Jane Doe <jane@example.com>", false}, // display-name form
		{"trailingdot@example.com.", false},
		{"@example.com", false},
		{"jane@", false},
	}
	for _, tc := range cases {
		if got := validInviteEmail(tc.email); got != tc.want {
			t.Errorf("validInviteEmail(%q) = %v, want %v", tc.email, got, tc.want)
		}
	}
}

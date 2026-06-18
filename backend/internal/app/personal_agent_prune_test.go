package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsDefinitiveDeadToken(t *testing.T) {
	cases := map[string]bool{
		"account_inactive": true,
		"token_revoked":    true,
		// Intentionally NOT definitive — these can be transient or mid-rotation.
		"invalid_auth":      false,
		"ratelimited":       false,
		"not_authed":        false,
		"":                  false,
		"account_inactive ": true, // trimmed
	}
	for code, want := range cases {
		if got := isDefinitiveDeadToken(code); got != want {
			t.Errorf("isDefinitiveDeadToken(%q) = %v, want %v", code, got, want)
		}
	}
}

func TestPruneDecision(t *testing.T) {
	cases := []struct {
		name       string
		prevStreak int
		authOK     bool
		errCode    string
		wantStreak int
		wantPrune  bool
	}{
		// Healthy token always resets and never prunes.
		{"alive resets streak", 1, true, "", 0, false},
		{"alive from zero", 0, true, "", 0, false},

		// Definitive dead token accumulates; prunes only at the threshold.
		{"first dead pass", 0, false, "account_inactive", 1, false},
		{"second dead pass prunes", 1, false, "account_inactive", 2, true},
		{"token_revoked also counts", 1, false, "token_revoked", 2, true},
		{"streak past threshold still prunes", 2, false, "account_inactive", 3, true},

		// Ambiguous / transient outcomes reset the streak and never prune —
		// this is the guard against deleting a live agent mid-rotation or on a
		// flaky pass.
		{"invalid_auth resets", 1, false, "invalid_auth", 0, false},
		{"ratelimited resets", 1, false, "ratelimited", 0, false},
		{"empty code resets", 1, false, "", 0, false},

		// A non-definitive pass between two dead passes prevents the prune:
		// the streak must be CONSECUTIVE.
		{"interrupted streak cannot prune", 0, false, "invalid_auth", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStreak, gotPrune := pruneDecision(tc.prevStreak, tc.authOK, tc.errCode)
			if gotStreak != tc.wantStreak || gotPrune != tc.wantPrune {
				t.Fatalf("pruneDecision(%d, %v, %q) = (%d, %v), want (%d, %v)",
					tc.prevStreak, tc.authOK, tc.errCode, gotStreak, gotPrune, tc.wantStreak, tc.wantPrune)
			}
		})
	}
}

// TestPruneDecisionConsecutiveRequirement walks the exact incident shape: a
// genuinely dead account trips the prune on the second consecutive pass, and a
// single dead pass followed by recovery never prunes.
func TestPruneDecisionConsecutiveRequirement(t *testing.T) {
	// Dead account: two ticks → prune on the second.
	streak, prune := pruneDecision(0, false, "account_inactive")
	if prune || streak != 1 {
		t.Fatalf("pass 1: got (%d,%v), want (1,false)", streak, prune)
	}
	streak, prune = pruneDecision(streak, false, "account_inactive")
	if !prune || streak != 2 {
		t.Fatalf("pass 2: got (%d,%v), want (2,true)", streak, prune)
	}

	// Blip then recovery: dead once, then alive → never prunes, streak clears.
	streak, prune = pruneDecision(0, false, "account_inactive")
	if prune {
		t.Fatalf("blip pass 1 must not prune")
	}
	streak, prune = pruneDecision(streak, true, "")
	if prune || streak != 0 {
		t.Fatalf("recovery: got (%d,%v), want (0,false)", streak, prune)
	}
}

func TestSlackAuthTest(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		body     string
		wantOK   bool
		wantCode string
		wantErr  bool
	}{
		{"alive", 200, `{"ok":true,"user_id":"U1","team":"T1"}`, true, "", false},
		{"account_inactive", 200, `{"ok":false,"error":"account_inactive"}`, false, "account_inactive", false},
		{"token_revoked", 200, `{"ok":false,"error":"token_revoked"}`, false, "token_revoked", false},
		{"invalid_auth", 200, `{"ok":false,"error":"invalid_auth"}`, false, "invalid_auth", false},
		{"non-200 is error", 500, `nope`, false, "", true},
		{"unparseable is error", 200, `{not json`, false, "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer xoxb-test" {
					t.Errorf("missing/wrong bearer token: %q", got)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			prev := slackAuthTestURL
			slackAuthTestURL = srv.URL
			defer func() { slackAuthTestURL = prev }()

			ok, code, err := slackAuthTest(context.Background(), "xoxb-test")
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got ok=%v code=%q", ok, code)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if ok != tc.wantOK || code != tc.wantCode {
				t.Fatalf("got (ok=%v, code=%q), want (ok=%v, code=%q)", ok, code, tc.wantOK, tc.wantCode)
			}
		})
	}
}

func TestSlackAuthTestEmptyToken(t *testing.T) {
	if _, _, err := slackAuthTest(context.Background(), "  "); err == nil {
		t.Fatal("expected error for empty token")
	}
}

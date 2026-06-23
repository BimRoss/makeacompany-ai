package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// sensitiveRecord is a fully-populated record whose secret-bearing fields use
// unique sentinel values, so a leak shows up as a substring match in the
// serialized public JSON.
func sensitiveRecord() PersonalAgentRecord {
	return PersonalAgentRecord{
		ID:                 "agent_abc123",
		OwnerEmail:         "SENTINEL-owner@example.com",
		OwnerSlackUserID:   "U0OWNER",
		DisplayName:        "Scout",
		Description:        "A research sidekick.",
		LongDescription:    "Scout reads long docs and summarizes them.",
		SystemPrompt:       "SENTINEL-SYSTEM-PROMPT-secret-sauce",
		SlackAppID:         "A0APP",
		SlackClientID:      "SENTINEL-client-id",
		SlackClientSecret:  "SENTINEL-client-secret",
		SlackSigningSecret: "SENTINEL-signing-secret",
		OAuthAuthorizeURL:  "https://slack.com/oauth/SENTINEL-authorize",
		ServiceNamespace:   "SENTINEL-namespace",
		ServiceName:        "SENTINEL-service",
		ServicePort:        9999,
		BotUserID:          "U0BOT",
		KnowledgeToken:     "pak_SENTINEL-knowledge-token",
		Status:             PersonalAgentStatusInstalled,
		Visibility:         PersonalAgentVisibilityPublic,
		ShowIntelligence:   true,
		CreatedAt:          "2026-06-01T00:00:00Z",
		YouTubeSources: []PersonalAgentYouTubeSource{
			{
				URL:     "https://youtube.com/watch?v=SENTINEL-source-url",
				Title:   "Closing enterprise deals",
				Bullets: []string{"Lead with the buyer's pain", "  ", "Anchor high"},
			},
		},
	}
}

// The load-bearing security test: no secret, the raw system prompt, owner
// email, service coordinates, knowledge token, or source URL may appear in the
// serialized public profile — regardless of opt-in flags.
func TestBuildPublicAgentProfile_NeverLeaksSensitiveFields(t *testing.T) {
	rec := sensitiveRecord()
	profile := buildPublicAgentProfile(rec, "https://avatar.example/x.png", "Dana", checkoutInviteURL)

	raw, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("marshal profile: %v", err)
	}
	got := string(raw)

	forbidden := []string{
		"SENTINEL-SYSTEM-PROMPT-secret-sauce",
		"SENTINEL-client-id",
		"SENTINEL-client-secret",
		"SENTINEL-signing-secret",
		"SENTINEL-authorize",
		"SENTINEL-namespace",
		"SENTINEL-service",
		"SENTINEL-knowledge-token",
		"pak_",
		"SENTINEL-owner@example.com",
		"SENTINEL-source-url",
		"U0OWNER",
		"U0BOT",
	}
	for _, f := range forbidden {
		if strings.Contains(got, f) {
			t.Errorf("public profile JSON leaked %q\nfull payload: %s", f, got)
		}
	}
}

func TestBuildPublicAgentProfile_IntelligenceShownByDefault(t *testing.T) {
	rec := sensitiveRecord()

	// Shown regardless of the legacy ShowIntelligence flag: harvested sources
	// always surface on the public showcase now (no per-agent opt-in).
	for _, show := range []bool{false, true} {
		rec.ShowIntelligence = show
		p := buildPublicAgentProfile(rec, "", "", checkoutInviteURL)
		if len(p.Intelligence) != 1 {
			t.Fatalf("ShowIntelligence=%v should yield 1 block, got %d", show, len(p.Intelligence))
		}
		if p.Intelligence[0].Title != "Closing enterprise deals" {
			t.Errorf("unexpected title: %q", p.Intelligence[0].Title)
		}
		// Blank bullet should have been dropped.
		if len(p.Intelligence[0].Bullets) != 2 {
			t.Errorf("expected 2 non-empty bullets, got %d: %v", len(p.Intelligence[0].Bullets), p.Intelligence[0].Bullets)
		}
	}

	// No harvested sources means no cards, even though the section is no longer gated.
	rec.YouTubeSources = nil
	if p := buildPublicAgentProfile(rec, "", "", checkoutInviteURL); len(p.Intelligence) != 0 {
		t.Errorf("no sources should yield no intelligence, got %d blocks", len(p.Intelligence))
	}
}

func TestBuildPublicAgentProfile_CarriesPublicFields(t *testing.T) {
	rec := sensitiveRecord()
	p := buildPublicAgentProfile(rec, "https://avatar.example/x.png", "Dana", checkoutInviteURL)
	if p.DisplayName != "Scout" || p.Description != "A research sidekick." {
		t.Errorf("public fields not carried: %+v", p)
	}
	if p.BuiltBy != "Dana" {
		t.Errorf("builtBy = %q, want Dana", p.BuiltBy)
	}
	if p.AvatarURL != "https://avatar.example/x.png" {
		t.Errorf("avatarUrl = %q", p.AvatarURL)
	}
	if p.InviteURL != checkoutInviteURL {
		t.Errorf("inviteUrl = %q, want %q", p.InviteURL, checkoutInviteURL)
	}
}

func TestEffectivePersonalAgentVisibility(t *testing.T) {
	cases := map[string]string{
		"":          PersonalAgentVisibilityPrivate,
		"private":   PersonalAgentVisibilityPrivate,
		"garbage":   PersonalAgentVisibilityPrivate,
		"unlisted":  PersonalAgentVisibilityUnlisted,
		"public":    PersonalAgentVisibilityPublic,
		"  public ": PersonalAgentVisibilityPublic,
	}
	for in, want := range cases {
		if got := effectivePersonalAgentVisibility(in); got != want {
			t.Errorf("effectivePersonalAgentVisibility(%q) = %q, want %q", in, got, want)
		}
	}
}

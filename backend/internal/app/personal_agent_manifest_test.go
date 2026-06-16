package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRenderPersonalAgentManifest_Success(t *testing.T) {
	out, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        "Garth",
		Description:        "Grant's personal agent",
		LongDescription:    "",
		EventsRequestURL:   "https://events.makeacompany.ai/slack/events",
		InstallRedirectURL: "https://makeacompany.ai/v1/personal-agents/abc/install-complete",
	})
	if err != nil {
		t.Fatalf("RenderPersonalAgentManifest: %v", err)
	}
	// Round-trip + spot-check substitutions.
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	di := parsed["display_information"].(map[string]any)
	if di["name"].(string) != "Garth" {
		t.Errorf("display_information.name = %v", di["name"])
	}
	if di["description"].(string) != "Grant's personal agent" {
		t.Errorf("display_information.description = %v", di["description"])
	}
	// long_description falls back to description when blank.
	if di["long_description"].(string) != "Grant's personal agent" {
		t.Errorf("long_description fallback failed: %v", di["long_description"])
	}
	settings := parsed["settings"].(map[string]any)
	if settings["socket_mode_enabled"].(bool) {
		t.Error("socket_mode_enabled must be false in the personal-agent baseline")
	}
	events := settings["event_subscriptions"].(map[string]any)
	if events["request_url"].(string) != "https://events.makeacompany.ai/slack/events" {
		t.Errorf("events request_url = %v", events["request_url"])
	}
	oauth := parsed["oauth_config"].(map[string]any)
	redirects := oauth["redirect_urls"].([]any)
	if len(redirects) != 1 || redirects[0].(string) != "https://makeacompany.ai/v1/personal-agents/abc/install-complete" {
		t.Errorf("redirect_urls = %v", redirects)
	}
}

func TestRenderPersonalAgentManifest_RejectsEmpty(t *testing.T) {
	cases := []PersonalAgentManifestSubstitutions{
		{Description: "x", EventsRequestURL: "u1", InstallRedirectURL: "u2"},
		{DisplayName: "n", EventsRequestURL: "u1", InstallRedirectURL: "u2"},
		{DisplayName: "n", Description: "x", InstallRedirectURL: "u2"},
		{DisplayName: "n", Description: "x", EventsRequestURL: "u1"},
	}
	for i, c := range cases {
		if _, err := RenderPersonalAgentManifest(c); err == nil {
			t.Errorf("case %d: expected error for missing field, got nil", i)
		}
	}
}

func TestRenderPersonalAgentManifest_EscapesQuotes(t *testing.T) {
	// A display name containing a quote would break the manifest if substituted naively.
	out, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        `Grant's "agent"`,
		Description:        "x",
		EventsRequestURL:   "https://e",
		InstallRedirectURL: "https://i",
	})
	if err != nil {
		t.Fatalf("expected escaped quotes to survive, got %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("escaping produced invalid JSON: %v", err)
	}
	di := parsed["display_information"].(map[string]any)
	if di["name"].(string) != `Grant's "agent"` {
		t.Errorf("name not round-tripped through JSON escape: %q", di["name"])
	}
}

func TestPersonalAgentTemplate_BotScopesParityWithBASELINE(t *testing.T) {
	// Sanity check that the vendored template still ships the BASELINE bot scopes.
	// Drift here means slack-factory/manifests/personal-agent-baseline/ and the
	// vendored copy here have diverged.
	out, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        "x",
		Description:        "x",
		EventsRequestURL:   "https://e",
		InstallRedirectURL: "https://i",
	})
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"app_mentions:read", "chat:write", "chat:write.public",
		"im:read", "im:write", "im:history",
		"mpim:read", "mpim:write", "mpim:write.topic", "mpim:history",
		"reactions:read", "reactions:write",
		"channels:join", "channels:history", "channels:read",
		"groups:history",
		"files:read", "files:write",
		"users:read", "users:read.email",
	}
	for _, scope := range required {
		if !strings.Contains(string(out), scope) {
			t.Errorf("BASELINE scope %q missing from rendered manifest", scope)
		}
	}
}

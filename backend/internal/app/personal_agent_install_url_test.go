package app

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// TestRefreshedPersonalAgentInstallURL_PrefersAPIThenFallback exercises the
// resolution order the edit + backfill paths rely on for #653:
//   - when apps.manifest.update echoes oauth_authorize_url, use it verbatim
//     (team-pinned);
//   - when it omits the URL, rebuild from the rendered manifest's current scopes
//     (team-pinned), which must include groups:read.
func TestRefreshedPersonalAgentInstallURL_PrefersAPIThenFallback(t *testing.T) {
	s := &Server{cfg: Config{MakeacompanySlackTeamID: "T0TEAM"}}

	manifest, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        "Garth",
		Description:        "x",
		EventsRequestURL:   "https://e",
		InstallRedirectURL: "https://i",
	})
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	// 1. API-returned URL wins; team= is pinned on.
	apiURL := "https://slack.com/oauth/v2/authorize?client_id=111.222&scope=groups%3Aread%2Cchat%3Awrite"
	got := s.refreshedPersonalAgentInstallURL(&ManifestUpdateResponse{OK: true, OAuthAuthorizeURL: apiURL}, manifest, "111.222")
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("api URL parse: %v", err)
	}
	if u.Query().Get("team") != "T0TEAM" {
		t.Errorf("api URL not team-pinned: %q", got)
	}
	if !strings.Contains(u.Query().Get("scope"), "groups:read") {
		t.Errorf("api URL lost scopes: %q", got)
	}

	// 2. Response omits the URL → fall back to constructing from manifest scopes.
	got = s.refreshedPersonalAgentInstallURL(&ManifestUpdateResponse{OK: true}, manifest, "111.222")
	u, err = url.Parse(got)
	if err != nil {
		t.Fatalf("fallback URL parse: %v", err)
	}
	if u.Query().Get("client_id") != "111.222" {
		t.Errorf("fallback client_id = %q", u.Query().Get("client_id"))
	}
	if !strings.Contains(u.Query().Get("scope"), "groups:read") {
		t.Errorf("fallback URL missing groups:read scope: %q", got)
	}
	if u.Query().Get("team") != "T0TEAM" {
		t.Errorf("fallback URL not team-pinned: %q", got)
	}

	// 3. No API URL + empty client_id → "" so callers leave the stored value alone.
	if got := s.refreshedPersonalAgentInstallURL(&ManifestUpdateResponse{OK: true}, manifest, ""); got != "" {
		t.Errorf("expected empty result when nothing to build, got %q", got)
	}
	// nil response is tolerated (treated as omitted URL).
	if got := s.refreshedPersonalAgentInstallURL(nil, json.RawMessage(`{}`), ""); got != "" {
		t.Errorf("nil resp + empty client should yield empty, got %q", got)
	}
}

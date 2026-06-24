package app

import (
	_ "embed"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
)

//go:embed templates/personal-agent-manifest.json
var personalAgentManifestTemplate string

// slackManifestLongDescMinChars is the minimum length Slack enforces on
// display_information.long_description when the field is present (175). See
// the failed_constraint min_length error in apps.manifest.create responses.
const slackManifestLongDescMinChars = 175

// personalAgentPlatformSuffix is appended when the user-supplied long
// description doesn't meet Slack's minimum. Worded so it reads naturally
// after the user's own description.
const personalAgentPlatformSuffix = "Built on the makeacompany.ai personal-agents platform — a Slack-resident AI bound to the authorizing user's identity, with owner-only message gating."

// PersonalAgentManifestSubstitutions are the placeholders the provisioner
// fills in before calling apps.manifest.create. The seed lives at
// templates/personal-agent-manifest.json — kept in sync with the canonical
// one at slack-factory/manifests/personal-agent-baseline/app-manifest.json.
//
// `EventsRequestURL` is constant across agents (gateway routes by api_app_id).
// `InstallRedirectURL` is per-agent so the install callback knows which agent
// the auth code belongs to.
type PersonalAgentManifestSubstitutions struct {
	DisplayName        string
	Description        string
	LongDescription    string
	EventsRequestURL   string
	InstallRedirectURL string
}

// RenderPersonalAgentManifest substitutes the placeholders and returns valid
// JSON ready to hand to apps.manifest.create. Fails if any required field is
// empty or the result is not valid JSON (template drift catch).
func RenderPersonalAgentManifest(sub PersonalAgentManifestSubstitutions) (json.RawMessage, error) {
	if strings.TrimSpace(sub.DisplayName) == "" {
		return nil, errors.New("display name required")
	}
	if strings.TrimSpace(sub.Description) == "" {
		return nil, errors.New("description required")
	}
	if strings.TrimSpace(sub.EventsRequestURL) == "" {
		return nil, errors.New("events request url required")
	}
	if strings.TrimSpace(sub.InstallRedirectURL) == "" {
		return nil, errors.New("install redirect url required")
	}

	// Slack rejects manifests where display_information.long_description is
	// non-empty and < 175 characters (failed_constraint min_length). We always
	// include it (because the template has the key), so we have to ensure the
	// rendered value clears the bar. Strategy:
	//   1. Use the user-supplied long_description if it's >= 175 chars.
	//   2. Else compose from short_description + a platform suffix that
	//      explains what makes this app what it is. Padded out to >= 175.
	longDesc := strings.TrimSpace(sub.LongDescription)
	if len(longDesc) < slackManifestLongDescMinChars {
		shortDesc := strings.TrimSpace(sub.Description)
		// Compose: <user long desc OR short desc>. <platform suffix>.
		base := longDesc
		if base == "" {
			base = shortDesc
		}
		composed := base + ". " + personalAgentPlatformSuffix
		// If still short (very rare — short desc + suffix should be >= 175
		// given the suffix is ~140 chars), repeat the suffix.
		for len(composed) < slackManifestLongDescMinChars {
			composed += " " + personalAgentPlatformSuffix
		}
		longDesc = composed
	}

	// Slack manifest fields are JSON strings, so the substituted values must
	// be safely escaped. json.Marshal returns a JSON-encoded string including
	// surrounding quotes; strip them and embed.
	escape := func(s string) string {
		b, _ := json.Marshal(s)
		// b is a JSON-encoded string like `"foo \"bar\""`. The template has the
		// placeholder wrapped in JSON quotes already, so strip the outer quotes
		// here before swapping.
		return string(b[1 : len(b)-1])
	}

	out := personalAgentManifestTemplate
	out = strings.ReplaceAll(out, "{{display_name}}", escape(sub.DisplayName))
	out = strings.ReplaceAll(out, "{{description}}", escape(sub.Description))
	out = strings.ReplaceAll(out, "{{long_description}}", escape(longDesc))
	out = strings.ReplaceAll(out, "{{events_request_url}}", escape(sub.EventsRequestURL))
	out = strings.ReplaceAll(out, "{{install_redirect_url}}", escape(sub.InstallRedirectURL))

	// Validate. If template + substitution drifted, fail loud here instead of
	// letting Slack reject the request with an unhelpful error.
	var probe map[string]any
	if err := json.Unmarshal([]byte(out), &probe); err != nil {
		return nil, errors.New("rendered manifest is not valid JSON (placeholder drift?): " + err.Error())
	}
	return json.RawMessage(out), nil
}

// PersonalAgentInstallURLFromManifest constructs the Slack OAuth v2 authorize
// URL for an app from its CURRENT manifest bot scopes + client_id. It is the
// fallback for when apps.manifest.update's response omits oauth_authorize_url:
// the API-returned value is always preferred, but this lets the backfill/edit
// paths still refresh a stale URL using the scopes Slack just accepted.
//
// Shape mirrors what apps.manifest.create returns:
//
//	https://slack.com/oauth/v2/authorize?client_id=<id>&scope=<comma-joined bot scopes>
//
// scope is comma-joined then URL-encoded (url.Values does the encoding). Returns
// "" when client_id is empty (no useful URL to build) so callers can keep the
// previously stored value rather than overwrite it with a half-built one.
func PersonalAgentInstallURLFromManifest(manifest json.RawMessage, clientID string) string {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return ""
	}
	var parsed struct {
		OAuthConfig struct {
			Scopes struct {
				Bot []string `json:"bot"`
			} `json:"scopes"`
		} `json:"oauth_config"`
	}
	if err := json.Unmarshal(manifest, &parsed); err != nil {
		return ""
	}
	q := url.Values{}
	q.Set("client_id", clientID)
	// Slack joins bot scopes with commas in the create-time authorize URL.
	q.Set("scope", strings.Join(parsed.OAuthConfig.Scopes.Bot, ","))
	return "https://slack.com/oauth/v2/authorize?" + q.Encode()
}

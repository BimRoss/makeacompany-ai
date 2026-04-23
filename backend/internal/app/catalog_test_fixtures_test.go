package app

import "time"

// testCatalogFixture returns a full valid catalog for unit tests only. Production catalog data
// is seeded from slack-orchestrator (see GetCapabilityCatalog) or admin PUT.
func testCatalogFixture() CapabilityCatalog {
	return CapabilityCatalog{
		Revision: "default",
		CoreEmployees: []CapabilityCatalogEmployee{
			{ID: "alex", Label: "Alex", Description: "Test Alex."},
			{ID: "tim", Label: "Tim", Description: "Test Tim."},
			{ID: "ross", Label: "Ross", Description: "Test Ross."},
			{ID: "garth", Label: "Garth", Description: "Test Garth."},
			{ID: "joanne", Label: "Joanne", Description: "Test Joanne."},
		},
		Skills: []CapabilityCatalogSkill{
			{
				ID:             "create-email",
				Label:          "Create Email",
				Description:    "Draft, send, and triage email communication. Requires confirmation before send.",
				RuntimeTool:    "joanne-create-email",
				RequiredParams: []string{"intent", "to"},
				OptionalParams: []string{"button", "link"},
				ParamDefaults: map[string]string{
					"to":     "Message author (Slack profile; makeacompany slack→email index when configured)",
					"button": "none",
					"link":   "none",
				},
				Requires: []string{"google_oauth"},
			},
			{
				ID:             "create-doc",
				Label:          "Create Doc",
				Description:    "Create, edit, and organize working docs. Requires confirmation before publish.",
				RuntimeTool:    "joanne-create-doc",
				RequiredParams: []string{"intent", "title", "editors"},
				OptionalParams: []string{"commenters", "viewers", "type", "length"},
				ParamDefaults: map[string]string{
					"title":      "Derived from intent when omitted; runtime infers a working title before draft",
					"editors":    "Message author email (implicit default); append @mentions or explicit editor emails",
					"type":       "outline",
					"length":     "Defaults to one page when omitted",
					"commenters": "none",
					"viewers":    "none",
				},
				Requires: []string{"google_oauth"},
			},
			{
				ID:             "create-company",
				Label:          "Create Company",
				Description:    "Provision a company channel, run onboarding, create channels, and invite members. Requires explicit Confirm/Cancel before any write.",
				RuntimeTool:    "joanne-create-company",
				RequiredParams: []string{"name", "founders"},
				OptionalParams: []string{},
				ParamDefaults: map[string]string{
					"name":     "Company / channel slug (gathered in-thread when not in the first message)",
					"founders": "Message author (implicit default); the skill appends @mentioned cofounders",
				},
				Requires: []string{"slack_workspace"},
			},
			{
				ID:             "delete-company",
				Label:          "Delete Company",
				Description:    "Permanently delete a company Slack channel and remove app-owned Redis data for that workspace (frees the channel name). Requires explicit Confirm/Cancel before any write.",
				RuntimeTool:    "joanne-delete-company",
				RequiredParams: []string{"channel"},
				OptionalParams: []string{},
				ParamDefaults: map[string]string{
					"channel": "The Slack channel where the command runs (implicit default; operators do not pass this at runtime)",
				},
				Requires: []string{"slack_workspace"},
			},
			{
				ID:             "read-company",
				Label:          "Read Company",
				Description:    "Summarize this channel from cached Slack history in Redis (hourly digest). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "joanne-read-company",
				RequiredParams: []string{},
				OptionalParams: []string{},
				Requires:       []string{"redis_channel_knowledge"},
			},
			{
				ID:             "read-skills",
				Label:          "Read Skills",
				Description:    "List team skills from the capability catalog (who has which skills). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "joanne-read-skills",
				RequiredParams: []string{},
				OptionalParams: []string{},
			},
			{
				ID:             "read-user",
				Label:          "Read User",
				Description:    "Show the message author's Stripe customer id, Slack user id, and Slack workspace team id. Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "joanne-read-user",
				RequiredParams: []string{},
				OptionalParams: []string{},
			},
			{
				ID:             "read-twitter",
				Label:          "Read Twitter",
				Description:    "Search Twitter by keyword and fetch high-impression tweets (not the platform trend list). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "garth-read-twitter",
				RequiredParams: []string{"query"},
				OptionalParams: []string{"count"},
				Requires:       []string{"twitter_indexer"},
			},
			{
				ID:             "read-trends",
				Label:          "Read Trends",
				Description:    "Fetch the current Twitter/X trend list (not keyword search). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "garth-read-trends",
				RequiredParams: []string{},
				OptionalParams: []string{},
				Requires:       []string{"twitter_indexer"},
			},
		},
		EmployeeSkillIDs: map[string][]string{
			"alex":   {},
			"tim":    {},
			"ross":   {"read-user"},
			"garth":  {"read-twitter", "read-trends"},
			"joanne": {"read-company", "read-skills", "read-user", "create-company", "delete-company", "create-email", "create-doc"},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "test-fixture",
	}
}

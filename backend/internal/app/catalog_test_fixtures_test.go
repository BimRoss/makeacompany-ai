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
				RequiredParams: []string{"intent"},
				OptionalParams: []string{"subject", "to", "button", "commenters", "editors", "link", "viewers"},
				ParamDefaults: map[string]string{
					"subject":    "Note from BimRoss",
					"to":         "Slack requester's profile email",
					"button":     "none",
					"commenters": "none",
					"editors":    "none",
					"link":       "none",
					"viewers":    "none",
				},
				Requires: []string{"google_oauth"},
			},
			{
				ID:             "create-doc",
				Label:          "Create Doc",
				Description:    "Create, edit, and organize working docs. Requires confirmation before publish.",
				RuntimeTool:    "joanne-create-doc",
				RequiredParams: []string{"intent"},
				OptionalParams: []string{"title", "type", "commenters", "editors", "viewers"},
				ParamDefaults: map[string]string{
					"title":      "Doc from BimRoss",
					"type":       "outline",
					"commenters": "none",
					"editors":    "none",
					"viewers":    "none",
				},
				Requires: []string{"google_oauth"},
			},
			{
				ID:             "create-company",
				Label:          "Create Company",
				Description:    "Provision a company channel, run onboarding, create channels, and invite members. Requires explicit Confirm/Cancel before any write.",
				RuntimeTool:    "joanne-create-company",
				RequiredParams: []string{"name"},
				OptionalParams: []string{"founders"},
				ParamDefaults: map[string]string{
					"founders": "Message author; add others with @mention",
				},
				Requires: []string{"slack_workspace"},
			},
			{
				ID:             "delete-company",
				Label:          "Delete Company",
				Description:    "Permanently delete a company Slack channel and remove app-owned Redis data for that workspace (frees the channel name). Requires explicit Confirm/Cancel before any write.",
				RuntimeTool:    "joanne-delete-company",
				RequiredParams: []string{},
				OptionalParams: []string{"channel"},
				ParamDefaults: map[string]string{
					"channel": "Current channel, or #name / channel link",
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
			"ross":   {},
			"garth":  {"read-twitter", "read-trends"},
			"joanne": {"read-company", "read-skills", "create-company", "delete-company", "create-email", "create-doc"},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "test-fixture",
	}
}

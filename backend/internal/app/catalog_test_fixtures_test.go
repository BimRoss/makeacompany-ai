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
				Description:    "Design and send email, to one or a hundred. Bulk concurrency handled, HTML supported natively. Requires confirmation before send.",
				RuntimeTool:    "joanne-create-email",
				RequiredParams: []string{"intent", "to", "subject"},
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
				Description:    "Create Google documents, outlines, and game plans. Pair with search skills to produce research documents in seconds.",
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
				Description:    "Start a private company channel from a name (slug); founders default to you plus @mentioned cofounders.",
				RuntimeTool:    "joanne-create-company",
				RequiredParams: []string{"name"},
				OptionalParams: []string{"founders"},
				ParamDefaults: map[string]string{
					"name":     "Company / channel slug (gathered in-thread when not in the first message)",
					"founders": "Optional; when omitted defaults to the message author plus any @mentioned cofounders",
				},
				Requires: []string{"slack_workspace"},
			},
			{
				ID:             "delete-company",
				Label:          "Delete Company",
				Description:    "Removes a company and sends it to the archive. Requires confirmation.",
				RuntimeTool:    "joanne-delete-company",
				RequiredParams: []string{"name"},
				OptionalParams: []string{},
				ParamDefaults: map[string]string{
					"name": "Company / channel slug (gathered in-thread when not in the first message)",
				},
				Requires: []string{"slack_workspace"},
			},
			{
				ID:             "read-company",
				Label:          "Read Company",
				Description:    "Summarize the latest activity within the company.",
				RuntimeTool:    "joanne-read-company",
				RequiredParams: []string{},
				OptionalParams: []string{},
				Requires:       []string{"redis_channel_knowledge"},
			},
			{
				ID:             "read-skills",
				Label:          "Read Skills",
				Description:    "Display the skills of the team",
				RuntimeTool:    "joanne-read-skills",
				RequiredParams: []string{},
				OptionalParams: []string{},
			},
			{
				ID:             "read-user",
				Label:          "Read User",
				Description:    "Display a user's company card.",
				RuntimeTool:    "joanne-read-user",
				RequiredParams: []string{},
				OptionalParams: []string{},
			},
			{
				ID:             "read-twitter",
				Label:          "Read Twitter",
				Description:    "Search twitter for high-impression tweets on any topic",
				RuntimeTool:    "garth-read-twitter",
				RequiredParams: []string{"query"},
				OptionalParams: []string{"count"},
				Requires:       []string{"twitter_indexer"},
			},
			{
				ID:             "read-trends",
				Label:          "Read Trends",
				Description:    "Show the latest trends",
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
			"joanne": {"read-company", "read-skills", "read-user", "create-company", "delete-company", "create-email", "create-doc"},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "test-fixture",
	}
}

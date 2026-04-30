package app

import "testing"

func TestNormalizeCapabilityCatalogPreservesEmployeeDescriptions(t *testing.T) {
	catalog := testCatalogFixture()
	custom := "Operator-edited Garth blurb from /admin — must round-trip through Redis."
	for i := range catalog.CoreEmployees {
		if catalog.CoreEmployees[i].ID == "garth" {
			catalog.CoreEmployees[i].Description = custom
			break
		}
	}
	normalized := normalizeCapabilityCatalog(catalog)
	var got string
	for _, e := range normalized.CoreEmployees {
		if e.ID == "garth" {
			got = e.Description
			break
		}
	}
	if got != custom {
		t.Fatalf("expected garth description preserved, got %q want %q", got, custom)
	}
}

func TestNormalizeCapabilityCatalogPreservesSkillLabels(t *testing.T) {
	catalog := testCatalogFixture()
	custom := "Custom Write Email Label"
	for i := range catalog.Skills {
		if normalizeCatalogSkillID(catalog.Skills[i].ID) == "create-email" {
			catalog.Skills[i].Label = custom
			break
		}
	}
	normalized := normalizeCapabilityCatalog(catalog)
	var got string
	for _, s := range normalized.Skills {
		if normalizeCatalogSkillID(s.ID) == "create-email" {
			got = s.Label
			break
		}
	}
	if got != custom {
		t.Fatalf("expected create-email label preserved, got %q want %q", got, custom)
	}
}

func TestNormalizeCapabilityCatalogDerivesEmptyRuntimeTool(t *testing.T) {
	catalog := testCatalogFixture()
	for i := range catalog.Skills {
		if normalizeCatalogSkillID(catalog.Skills[i].ID) == "create-email" {
			catalog.Skills[i].RuntimeTool = ""
			break
		}
	}
	catalog.EmployeeSkillIDs["joanne"] = []string{"create-email"}

	normalized := normalizeCapabilityCatalog(catalog)
	var got string
	for _, s := range normalized.Skills {
		if normalizeCatalogSkillID(s.ID) == "create-email" {
			got = s.RuntimeTool
			break
		}
	}
	if got != "joanne-create-email" {
		t.Fatalf("expected derived runtime tool joanne-create-email, got %q", got)
	}
}

func TestValidateCapabilityCatalogAllowsArbitraryRuntimeTool(t *testing.T) {
	catalog := testCatalogFixture()
	catalog.Skills[0].RuntimeTool = "custom-tool-name"

	if err := validateCapabilityCatalog(catalog); err != nil {
		t.Fatalf("expected catalog to validate, got %v", err)
	}
}

func TestMergeCapabilityCatalogWithDefaultsRestoresNewSkills(t *testing.T) {
	// Simulate an older Redis payload: fewer skills, narrower employee assignments.
	def := testCatalogFixture()
	var slimSkills []CapabilityCatalogSkill
	for _, s := range def.Skills {
		id := normalizeCatalogSkillID(s.ID)
		if id == "read-company" || id == "read-trends" {
			continue
		}
		slimSkills = append(slimSkills, s)
	}
	joanneSkills := []string{"read-company", "create-email", "create-doc", "read-skills"}
	garthSkills := []string{"read-twitter"}
	catalog := CapabilityCatalog{
		Revision:      "old",
		CoreEmployees: def.CoreEmployees,
		Skills:        slimSkills,
		EmployeeSkillIDs: map[string][]string{
			"alex":   {},
			"tim":    {},
			"ross":   {},
			"garth":  garthSkills,
			"joanne": joanneSkills,
		},
	}
	merged := mergeCapabilityCatalogWithDefaults(catalog, def)
	normalized := normalizeCapabilityCatalog(merged)
	if err := validateCapabilityCatalog(normalized); err != nil {
		t.Fatalf("expected merged catalog to validate, got %v", err)
	}
	hasSkill := func(id string) bool {
		for _, s := range normalized.Skills {
			if normalizeCatalogSkillID(s.ID) == id {
				return true
			}
		}
		return false
	}
	if !hasSkill("read-company") || !hasSkill("read-trends") {
		t.Fatalf("expected merged skills to include read-company and read-trends")
	}
	joanne := normalized.EmployeeSkillIDs["joanne"]
	garth := normalized.EmployeeSkillIDs["garth"]
	if !containsString(joanne, "read-company") {
		t.Fatalf("expected joanne to gain read-company, got %#v", joanne)
	}
	if !containsString(garth, "read-trends") {
		t.Fatalf("expected garth to gain read-trends, got %#v", garth)
	}
}

func TestMergeCapabilityCatalogWithDefaultsRestoresNewEmployees(t *testing.T) {
	def := testCatalogFixture()
	def.CoreEmployees = append(def.CoreEmployees, CapabilityCatalogEmployee{
		ID:          "anna",
		Label:       "Anna",
		Description: "Head of Creative specializing in image concepts and generation workflows.",
	})
	def.Skills = append(def.Skills, CapabilityCatalogSkill{
		ID:             "create-image",
		Label:          "Create Image",
		Description:    "Generate an original image from a text prompt using Anna's creative workflow.",
		RuntimeTool:    "anna-create-image",
		RequiredParams: []string{"intent"},
		OptionalParams: []string{"style", "ratio", "size"},
	})
	def.EmployeeSkillIDs["anna"] = []string{"create-image"}

	catalog := testCatalogFixture()
	merged := normalizeCapabilityCatalog(mergeCapabilityCatalogWithDefaults(catalog, def))
	if err := validateCapabilityCatalog(merged); err != nil {
		t.Fatalf("expected merged catalog to validate, got %v", err)
	}
	if _, ok := merged.EmployeeSkillIDs["anna"]; !ok {
		t.Fatalf("expected merged employeeSkillIds to include anna")
	}
	foundAnna := false
	for _, employee := range merged.CoreEmployees {
		if employee.ID == "anna" {
			foundAnna = true
			break
		}
	}
	if !foundAnna {
		t.Fatalf("expected merged coreEmployees to include anna")
	}
	if !containsString(merged.EmployeeSkillIDs["anna"], "create-image") {
		t.Fatalf("expected anna to include create-image, got %#v", merged.EmployeeSkillIDs["anna"])
	}
}

func TestNormalizeCatalogSkillIDCanonicalizesReadWebAliases(t *testing.T) {
	cases := []string{
		"read-internet",
		"readinternet",
		"read_google",
		"read-google",
		"readgoogle",
		"read_web",
		"read web",
	}
	for _, in := range cases {
		if got := normalizeCatalogSkillID(in); got != "read-web" {
			t.Fatalf("expected %q to normalize to read-web, got %q", in, got)
		}
	}
}

func TestNormalizeCapabilityCatalogCanonicalizesLegacyReadWebSkill(t *testing.T) {
	catalog := testCatalogFixture()
	catalog.Skills = append(catalog.Skills, CapabilityCatalogSkill{
		ID:             "read-internet",
		Label:          "Read Internet",
		Description:    "Legacy alias should normalize to canonical read-web",
		RuntimeTool:    "alex-read-internet",
		RequiredParams: []string{"query"},
		OptionalParams: []string{"count"},
	})
	catalog.EmployeeSkillIDs["alex"] = []string{"read-internet"}

	normalized := normalizeCapabilityCatalog(catalog)

	var found bool
	for _, s := range normalized.Skills {
		if s.ID != "read-web" {
			continue
		}
		found = true
		if s.Label != "Read Web" {
			t.Fatalf("expected read-web label Read Web, got %q", s.Label)
		}
		if s.RuntimeTool != "alex-read-web" {
			t.Fatalf("expected runtime tool alex-read-web, got %q", s.RuntimeTool)
		}
	}
	if !found {
		t.Fatalf("expected canonical read-web skill in normalized catalog")
	}
	if !containsString(normalized.EmployeeSkillIDs["alex"], "read-web") {
		t.Fatalf("expected alex skill list to include read-web, got %#v", normalized.EmployeeSkillIDs["alex"])
	}
	if containsString(normalized.EmployeeSkillIDs["alex"], "read-internet") {
		t.Fatalf("expected alex skill list to exclude read-internet, got %#v", normalized.EmployeeSkillIDs["alex"])
	}
}

func containsString(list []string, want string) bool {
	for _, s := range list {
		if normalizeCatalogSkillID(s) == want {
			return true
		}
	}
	return false
}

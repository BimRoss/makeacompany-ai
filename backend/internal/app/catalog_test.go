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
	joanneSkills := []string{"read-company", "create-email", "create-doc", "create-slack"}
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

func containsString(list []string, want string) bool {
	for _, s := range list {
		if normalizeCatalogSkillID(s) == want {
			return true
		}
	}
	return false
}

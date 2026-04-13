package app

import "testing"

func TestNormalizeCapabilityCatalogMigratesLegacyRuntimeTool(t *testing.T) {
	catalog := defaultCapabilityCatalog()
	catalog.Skills[0].RuntimeTool = "joanne_email"
	catalog.EmployeeSkillIDs["joanne"] = []string{"write-email"}

	normalized := normalizeCapabilityCatalog(catalog)
	if len(normalized.Skills) == 0 {
		t.Fatal("expected normalized skills")
	}
	if normalized.Skills[0].RuntimeTool != "joanne-write-email" {
		t.Fatalf("expected migrated runtime tool joanne-write-email, got %q", normalized.Skills[0].RuntimeTool)
	}
}

func TestValidateCapabilityCatalogAllowsArbitraryRuntimeTool(t *testing.T) {
	catalog := defaultCapabilityCatalog()
	catalog.Skills[0].RuntimeTool = "custom-tool-name"

	if err := validateCapabilityCatalog(catalog); err != nil {
		t.Fatalf("expected catalog to validate, got %v", err)
	}
}

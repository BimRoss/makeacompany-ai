package app

import (
	"strings"
	"testing"
)

func TestValidateCapabilityCatalogRejectsUnsupportedRuntimeTool(t *testing.T) {
	catalog := defaultCapabilityCatalog()
	catalog.Skills[0].RuntimeTool = "not_a_real_tool"

	err := validateCapabilityCatalog(catalog)
	if err == nil {
		t.Fatal("expected unsupported runtime tool validation error")
	}
	if !strings.Contains(err.Error(), "unsupported runtimeTool") {
		t.Fatalf("expected unsupported runtimeTool error, got %v", err)
	}
}

func TestValidateCapabilityCatalogAllowsSupportedRuntimeTool(t *testing.T) {
	catalog := defaultCapabilityCatalog()
	catalog.Skills[0].RuntimeTool = "ross_ops"

	if err := validateCapabilityCatalog(catalog); err != nil {
		t.Fatalf("expected supported runtime tool to validate, got %v", err)
	}
}

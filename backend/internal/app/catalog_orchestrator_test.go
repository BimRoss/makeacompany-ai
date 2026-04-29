package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchCapabilityCatalogFromOrchestrator_OK(t *testing.T) {
	t.Parallel()
	sample := CapabilityContractLikeOrchestrator(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method %s", r.Method)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("expected no Authorization header, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sample)
	}))
	t.Cleanup(srv.Close)

	got, err := FetchCapabilityCatalogFromOrchestrator(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got.Source != "slack-orchestrator" {
		t.Fatalf("source: %q", got.Source)
	}
	if len(got.Skills) < 1 || got.Skills[0].ID == "" {
		t.Fatalf("unexpected catalog: %#v", got)
	}
}

func TestFetchCapabilityCatalogFromOrchestrator_Unauthorized(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)

	_, err := FetchCapabilityCatalogFromOrchestrator(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestFetchCapabilityCatalogFromOrchestrator_FallbackDebugPathToPublicV1(t *testing.T) {
	t.Parallel()
	sample := CapabilityContractLikeOrchestrator(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/debug/capability-catalog":
			http.NotFound(w, r)
		case "/v1/public/capability-catalog":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sample)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	got, err := FetchCapabilityCatalogFromOrchestrator(context.Background(), srv.URL+"/debug/capability-catalog")
	if err != nil {
		t.Fatal(err)
	}
	if got.Source != "slack-orchestrator" {
		t.Fatalf("source: %q", got.Source)
	}
	if len(got.Skills) < 1 || got.Skills[0].ID == "" {
		t.Fatalf("unexpected catalog: %#v", got)
	}
}

// CapabilityContractLikeOrchestrator returns a minimal valid catalog matching slack-orchestrator shape.
func CapabilityContractLikeOrchestrator(t *testing.T) CapabilityCatalog {
	t.Helper()
	return CapabilityCatalog{
		Revision: "default",
		CoreEmployees: []CapabilityCatalogEmployee{
			{ID: "alex", Label: "Alex", Description: "Sales."},
		},
		Skills: []CapabilityCatalogSkill{
			{
				ID: "read-company", Label: "Read Company", Description: "Read.",
				RuntimeTool: "joanne-read-company", RequiredParams: []string{}, OptionalParams: []string{},
			},
		},
		EmployeeSkillIDs: map[string][]string{
			"alex": {"read-company"},
		},
	}
}

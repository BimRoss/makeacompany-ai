package app

import (
	"sort"
	"testing"
)

// canonicalDefaultSkillIDs mirrors employee-factory skillcontract.CanonicalDefaultSkillIDs.
// When the default contract grows, update both places and re-run sync against orchestrator.
var canonicalDefaultSkillIDs = []string{
	"create-company",
	"create-doc",
	"create-email",
	"delete-company",
	"read-company",
	"read-skills",
	"read-user",
	"read-trends",
	"read-twitter",
}

func TestDefaultCapabilityCatalogMatchesCanonicalSkillIDs(t *testing.T) {
	want := make(map[string]struct{}, len(canonicalDefaultSkillIDs))
	for _, id := range canonicalDefaultSkillIDs {
		want[id] = struct{}{}
	}
	def := testCatalogFixture()
	var gotIDs []string
	for _, s := range def.Skills {
		id := normalizeCatalogSkillID(s.ID)
		if id == "" {
			continue
		}
		gotIDs = append(gotIDs, id)
		if _, ok := want[id]; !ok {
			t.Fatalf("default catalog has unexpected skill id %q (add to canonicalDefaultSkillIDs or remove from default)", id)
		}
		delete(want, id)
	}
	if len(want) != 0 {
		var missing []string
		for id := range want {
			missing = append(missing, id)
		}
		sort.Strings(missing)
		t.Fatalf("default catalog missing skills: %v", missing)
	}
	sort.Strings(gotIDs)
	sort.Strings(canonicalDefaultSkillIDs)
	if len(gotIDs) != len(canonicalDefaultSkillIDs) {
		t.Fatalf("skill count mismatch: got %d want %d", len(gotIDs), len(canonicalDefaultSkillIDs))
	}
	for i := range gotIDs {
		if gotIDs[i] != canonicalDefaultSkillIDs[i] {
			t.Fatalf("skill id order/content mismatch at %d: got %q want %q", i, gotIDs[i], canonicalDefaultSkillIDs[i])
		}
	}
}

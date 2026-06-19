package app

import (
	"strings"
	"testing"
)

func TestApplyToCheckoutMetadata_PopulatesPresentFieldsOnly(t *testing.T) {
	p := &firstTouchPayload{
		Source:   "linkedin",
		Medium:   "social",
		Campaign: "",
		Path:     "/for/founders",
	}
	m := map[string]string{"source": "base_plan"}
	got := p.applyToCheckoutMetadata(m)
	if got != "linkedin" {
		t.Fatalf("source label = %q, want %q", got, "linkedin")
	}
	if m["ft_source"] != "linkedin" || m["ft_medium"] != "social" || m["ft_path"] != "/for/founders" {
		t.Fatalf("metadata missing expected keys: %#v", m)
	}
	if _, ok := m["ft_campaign"]; ok {
		t.Fatalf("empty campaign should not be written: %#v", m)
	}
	if m["source"] != "base_plan" {
		t.Fatalf("base metadata clobbered: %#v", m)
	}
}

func TestApplyToCheckoutMetadata_NilPayloadIsNoop(t *testing.T) {
	var p *firstTouchPayload
	m := map[string]string{"source": "base_plan"}
	if got := p.applyToCheckoutMetadata(m); got != "" {
		t.Fatalf("nil payload should return empty source, got %q", got)
	}
	if len(m) != 1 {
		t.Fatalf("nil payload mutated metadata: %#v", m)
	}
}

func TestApplyToCheckoutMetadata_TruncatesOversizeValues(t *testing.T) {
	huge := strings.Repeat("x", 1000)
	p := &firstTouchPayload{Source: huge}
	m := map[string]string{}
	_ = p.applyToCheckoutMetadata(m)
	if len(m["ft_source"]) != stripeMetadataValueMax {
		t.Fatalf("ft_source not truncated: len=%d", len(m["ft_source"]))
	}
}

func TestFirstTouchFieldsFromMetadata_RewritesKeys(t *testing.T) {
	md := map[string]string{
		"source":      "base_plan",
		"ft_source":   "linkedin",
		"ft_medium":   "social",
		"ft_path":     "/for/founders",
		"ft_campaign": "",
	}
	out := firstTouchFieldsFromMetadata(md)
	if out["first_touch_source"] != "linkedin" {
		t.Fatalf("first_touch_source missing: %#v", out)
	}
	if out["first_touch_medium"] != "social" || out["first_touch_path"] != "/for/founders" {
		t.Fatalf("expected fields missing: %#v", out)
	}
	if _, ok := out["first_touch_campaign"]; ok {
		t.Fatalf("empty campaign should be dropped: %#v", out)
	}
	if _, ok := out["source"]; ok {
		t.Fatalf("non-ft metadata leaked through: %#v", out)
	}
}

func TestFirstTouchFieldsFromMetadata_EmptyWhenNoFTKeys(t *testing.T) {
	out := firstTouchFieldsFromMetadata(map[string]string{"source": "base_plan", "ref": "john"})
	if len(out) != 0 {
		t.Fatalf("expected empty map, got %#v", out)
	}
}

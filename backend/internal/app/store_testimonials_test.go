package app

import (
	"strings"
	"testing"
)

func TestNormalizeTestimonialRole(t *testing.T) {
	cases := map[string]string{
		"":                          "",
		"   ":                       "",
		"founder, acme":             "Founder, Acme",
		"  cto ,  BimRoss  ":        "Cto, BimRoss",
		"Founder, Acme":             "Founder, Acme",
		"founder ,  ,  acme":        "Founder, Acme",
		"head of growth":            "Head of growth",
		"cto, BimRoss, advisor":     "Cto, BimRoss, Advisor",
		"FOUNDER, ACME":             "FOUNDER, ACME", // we only touch the first rune
	}
	for in, want := range cases {
		if got := NormalizeTestimonialRole(in); got != want {
			t.Errorf("NormalizeTestimonialRole(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeTestimonialContent(t *testing.T) {
	cases := map[string]string{
		"":                  "",
		"  hello  ":         "hello",
		`"hello"`:           "hello",
		`'hello'`:           "hello",
		"“hello”":           "hello",
		"‘hello’":           "hello",
		`"he said "hi""`:    `he said "hi"`,
		"no outer quotes":   "no outer quotes",
		`"unmatched`:        `"unmatched`,
		`unmatched"`:        `unmatched"`,
		`  "padded"  `:      "padded",
	}
	for in, want := range cases {
		if got := NormalizeTestimonialContent(in); got != want {
			t.Errorf("NormalizeTestimonialContent(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateTestimonial(t *testing.T) {
	t.Run("normalizes role and strips outer quotes", func(t *testing.T) {
		got := Testimonial{Name: "Jane Doe", Role: "founder, acme", Content: `"great product"`}
		if err := ValidateTestimonial(&got); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got.Role != "Founder, Acme" {
			t.Errorf("role = %q, want %q", got.Role, "Founder, Acme")
		}
		if got.Content != "great product" {
			t.Errorf("content = %q, want %q", got.Content, "great product")
		}
		if got.Status != "published" {
			t.Errorf("status default = %q, want published", got.Status)
		}
		if got.Avatar != "JD" {
			t.Errorf("avatar = %q, want JD", got.Avatar)
		}
	})

	t.Run("rejects role with newline", func(t *testing.T) {
		got := Testimonial{Name: "Jane", Role: "Founder\nAcme", Content: "great"}
		err := ValidateTestimonial(&got)
		if err == nil || !strings.Contains(err.Error(), "newline") {
			t.Errorf("err = %v, want newline error", err)
		}
	})

	t.Run("rejects role over 80 chars", func(t *testing.T) {
		got := Testimonial{Name: "Jane", Role: strings.Repeat("a", 81), Content: "great"}
		err := ValidateTestimonial(&got)
		if err == nil || !strings.Contains(err.Error(), "role exceeds") {
			t.Errorf("err = %v, want role-exceeds error", err)
		}
	})

	t.Run("rejects content over 240 chars", func(t *testing.T) {
		got := Testimonial{Name: "Jane", Role: "Founder, Acme", Content: strings.Repeat("a", 241)}
		err := ValidateTestimonial(&got)
		if err == nil || !strings.Contains(err.Error(), "content exceeds") {
			t.Errorf("err = %v, want content-exceeds error", err)
		}
	})

	t.Run("accepts content at the 240-char boundary", func(t *testing.T) {
		got := Testimonial{Name: "Jane", Role: "Founder, Acme", Content: strings.Repeat("a", 240)}
		if err := ValidateTestimonial(&got); err != nil {
			t.Errorf("unexpected err: %v", err)
		}
	})
}

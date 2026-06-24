package app

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPeekAgentIDFromBody_PreservesFullBody guards the regression where the
// agentId body-peek truncated the request body it handed back to the handler
// (#651). The peek must (a) extract agentId from a normal small body and (b)
// NEVER truncate the body the handler decodes — even when the body is far larger
// than the probe prefix (e.g. a multi-MiB icon upload).
func TestPeekAgentIDFromBody_PreservesFullBody(t *testing.T) {
	t.Run("small body: peeks id and preserves body", func(t *testing.T) {
		raw := `{"agentId":"a1","systemPrompt":"hello"}`
		r := httptest.NewRequest("POST", "/x", strings.NewReader(raw))
		if got := peekAgentIDFromBody(r); got != "a1" {
			t.Errorf("peeked agentId = %q, want a1", got)
		}
		got, _ := io.ReadAll(r.Body)
		if string(got) != raw {
			t.Errorf("body after peek = %q, want %q", got, raw)
		}
	})

	t.Run("body larger than probe prefix is preserved in full", func(t *testing.T) {
		// A valid JSON body well over the probe prefix (mimics a ~2 MiB icon
		// upload base64'd into the payload). The prefix-only parse fails, so no
		// agentId is peeked — but the handler must still receive every byte.
		big := strings.Repeat("A", peekAgentIDPrefixBytes+512*1024)
		raw := `{"agentId":"a1","image":"` + big + `"}`
		r := httptest.NewRequest("POST", "/x", strings.NewReader(raw))

		// Truncated prefix can't be parsed → no peeked id (back-compat path).
		if got := peekAgentIDFromBody(r); got != "" {
			t.Errorf("peeked agentId on oversized body = %q, want empty", got)
		}
		// The crux: the body the handler reads is the COMPLETE payload.
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read restored body: %v", err)
		}
		if len(got) != len(raw) {
			t.Fatalf("restored body len = %d, want %d (body was truncated)", len(got), len(raw))
		}
		if string(got) != raw {
			t.Error("restored body bytes differ from original")
		}
	})
}

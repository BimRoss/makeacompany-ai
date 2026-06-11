package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
)

// shopifyCanonicalQuery computes the same sorted "k=v&k=v" body Shopify
// signs. Kept inline (not exported) so we don't accidentally hand the
// caller code a way to construct signatures matching our verifier.
func shopifyCanonicalQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		if k == "hmac" || k == "signature" {
			continue
		}
		keys = append(keys, k)
	}
	// sort
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j-1] > keys[j]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(q.Get(k))
	}
	return b.String()
}

func shopifySignQuery(t *testing.T, q url.Values, secret string) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(shopifyCanonicalQuery(q)))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyShopifyCallbackHMAC(t *testing.T) {
	const secret = "test-fixture-not-a-real-shopify-secret"

	base := url.Values{}
	base.Set("code", "shopify-auth-code-xyz")
	base.Set("shop", "petes-shop.myshopify.com")
	base.Set("state", "deadbeef0123")
	base.Set("timestamp", "1733616000")
	base.Set("host", "petes-shop.myshopify.com/admin")

	t.Run("valid signature accepted", func(t *testing.T) {
		q := cloneValues(base)
		q.Set("hmac", shopifySignQuery(t, q, secret))
		if !verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("expected valid hmac to pass")
		}
	})

	t.Run("case insensitive on hex digits", func(t *testing.T) {
		q := cloneValues(base)
		sig := shopifySignQuery(t, q, secret)
		q.Set("hmac", strings.ToUpper(sig))
		if !verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("uppercased hex hmac should still pass")
		}
	})

	t.Run("missing hmac rejected", func(t *testing.T) {
		q := cloneValues(base)
		if verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("expected missing hmac to fail")
		}
	})

	t.Run("wrong secret rejected", func(t *testing.T) {
		q := cloneValues(base)
		q.Set("hmac", shopifySignQuery(t, q, secret))
		if verifyShopifyCallbackHMAC(q, "different-test-fixture-secret") {
			t.Fatalf("expected wrong secret to fail")
		}
	})

	t.Run("tampered shop rejected", func(t *testing.T) {
		q := cloneValues(base)
		q.Set("hmac", shopifySignQuery(t, q, secret))
		// Attacker swaps shop after signing — verifier must reject.
		q.Set("shop", "evil.myshopify.com")
		if verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("expected swapped shop to fail")
		}
	})

	t.Run("extra param injected after signing rejected", func(t *testing.T) {
		q := cloneValues(base)
		q.Set("hmac", shopifySignQuery(t, q, secret))
		// Inject an unsigned key — verifier folds it in and signature breaks.
		q.Set("extra", "evil")
		if verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("expected param injection to fail")
		}
	})

	t.Run("signature field name not folded into canonical", func(t *testing.T) {
		// Shopify excludes both hmac AND signature from the canonical
		// string. Confirm signature is ignored too — a leftover legacy
		// param shouldn't break validation.
		q := cloneValues(base)
		q.Set("hmac", shopifySignQuery(t, q, secret))
		q.Set("signature", "stale-legacy-sig-value")
		if !verifyShopifyCallbackHMAC(q, secret) {
			t.Fatalf("expected legacy `signature` param to be ignored, hmac should still pass")
		}
	})
}

func cloneValues(in url.Values) url.Values {
	out := url.Values{}
	for k, v := range in {
		cp := make([]string, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

func TestRandomHexNonce(t *testing.T) {
	a, err := randomHexNonce(32)
	if err != nil {
		t.Fatalf("nonce gen failed: %v", err)
	}
	if len(a) != 64 {
		t.Fatalf("nonce length = %d, want 64", len(a))
	}
	b, _ := randomHexNonce(32)
	if a == b {
		t.Fatalf("two consecutive nonces collided — RNG broken or both zero")
	}
}

func TestRedactNonce(t *testing.T) {
	full := "deadbeef0123deadbeef0123deadbeef0123deadbeef0123deadbeef0123dead"
	got := redactNonce(full)
	if strings.Contains(got, full) {
		t.Fatalf("redactNonce leaked full value: %q", got)
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("redactNonce missing ellipsis: %q", got)
	}
	if redactNonce("short") != "redacted" {
		t.Fatalf("short nonce should redact entirely")
	}
}

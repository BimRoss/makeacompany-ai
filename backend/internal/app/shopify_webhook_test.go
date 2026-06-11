package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestVerifyShopifyWebhookHMAC(t *testing.T) {
	const secret = "test-fixture-not-a-real-shopify-secret"
	body := []byte(`{"id":12345,"line_items":[{"product_id":1}]}`)

	// Compute the canonical signature the way Shopify would.
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	canonical := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	t.Run("valid signature accepted", func(t *testing.T) {
		if !verifyShopifyWebhookHMAC(body, canonical, secret) {
			t.Fatalf("expected valid HMAC to pass")
		}
	})

	t.Run("empty signature rejected", func(t *testing.T) {
		if verifyShopifyWebhookHMAC(body, "", secret) {
			t.Fatalf("expected empty signature to fail")
		}
	})

	t.Run("empty secret rejected", func(t *testing.T) {
		if verifyShopifyWebhookHMAC(body, canonical, "") {
			t.Fatalf("expected empty secret to fail (don't fall back to insecure mode)")
		}
	})

	t.Run("wrong secret rejected", func(t *testing.T) {
		if verifyShopifyWebhookHMAC(body, canonical, "different-test-fixture-secret") {
			t.Fatalf("expected wrong secret to fail")
		}
	})

	t.Run("tampered body rejected", func(t *testing.T) {
		tampered := []byte(`{"id":99999,"line_items":[{"product_id":1}]}`)
		if verifyShopifyWebhookHMAC(tampered, canonical, secret) {
			t.Fatalf("expected tampered body to fail")
		}
	})

	t.Run("truncated signature rejected", func(t *testing.T) {
		if verifyShopifyWebhookHMAC(body, canonical[:len(canonical)-1], secret) {
			t.Fatalf("expected truncated signature to fail")
		}
	})

	t.Run("hex-encoded signature rejected (must be base64)", func(t *testing.T) {
		// Defense against a future bug that swaps the encoding scheme — we
		// require base64 specifically because Shopify sends base64. If someone
		// accidentally swaps to hex.EncodeToString, this test catches it.
		hexEncoded := "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
		if verifyShopifyWebhookHMAC(body, hexEncoded, secret) {
			t.Fatalf("expected hex signature to fail")
		}
	})
}

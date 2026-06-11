package app

import "testing"

func TestValidShopifyShopDomain(t *testing.T) {
	cases := []struct {
		name string
		shop string
		ok   bool
	}{
		// canonical shapes
		{"simple", "petes-shop.myshopify.com", true},
		{"single-char", "a.myshopify.com", true},
		{"all-digits", "12345.myshopify.com", true},
		{"digits-and-dash", "8de8fa-3.myshopify.com", true},
		{"uppercased-input", "PETES-SHOP.myshopify.com", true}, // we lowercase before checking

		// rejections
		{"empty", "", false},
		{"bare-domain", "myshopify.com", false},
		{"wrong-suffix", "petes-shop.shopify.com", false},
		{"impostor-suffix", "petes-shop.myshopify.com.evil.com", false},
		{"prefix-attack", "evil.com.myshopify.com.evil.com", false},
		{"leading-hyphen", "-bad.myshopify.com", false},
		{"trailing-hyphen", "bad-.myshopify.com", false},
		{"underscore", "petes_shop.myshopify.com", false},
		{"dot-in-name", "pete.shop.myshopify.com", false},
		{"space", "petes shop.myshopify.com", false},
		{"too-long", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.myshopify.com", false},

		// path/query/scheme contamination — a misformed input we must reject
		{"with-scheme", "https://petes-shop.myshopify.com", false},
		{"with-path", "petes-shop.myshopify.com/admin", false},
		{"with-query", "petes-shop.myshopify.com?evil=1", false},
		{"with-port", "petes-shop.myshopify.com:8443", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ValidShopifyShopDomain(tc.shop)
			if got != tc.ok {
				t.Errorf("ValidShopifyShopDomain(%q) = %v, want %v", tc.shop, got, tc.ok)
			}
		})
	}
}

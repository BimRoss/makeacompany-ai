package app

import (
	"regexp"
	"strings"
)

// ValidShopifyShopDomain enforces the Shopify shop domain shape so we
// never redirect users to an attacker-controlled host pretending to be
// a Shopify shop. Shop domains look like:
//
//	pretty-name.myshopify.com
//	8de8fa-3.myshopify.com   (the Shopify-assigned ones with digits + dashes)
//
// Rules:
//   - lowercase alphanumerics + hyphens, not starting or ending with `-`
//   - must end with `.myshopify.com`
//   - total length capped at 60 + ".myshopify.com" = 74 chars (Shopify's own limit)
func ValidShopifyShopDomain(shop string) bool {
	shop = strings.ToLower(strings.TrimSpace(shop))
	if !strings.HasSuffix(shop, ".myshopify.com") {
		return false
	}
	name := strings.TrimSuffix(shop, ".myshopify.com")
	return shopifyShopNameRe.MatchString(name)
}

// shopifyShopNameRe is the strict shop-handle subset Shopify uses for
// `.myshopify.com` subdomains. Anchored at both ends; no leading/trailing
// hyphen, no consecutive dots, no underscores.
var shopifyShopNameRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$`)

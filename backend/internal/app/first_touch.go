package app

import "strings"

// firstTouchPayload mirrors the FirstTouchPayload shape the lander writes into
// the mac_first_touch cookie (src/lib/first-touch.ts). The frontend posts it
// alongside the checkout request so we can stamp the original acquisition
// source onto the Stripe session metadata (preserved across the redirect) and,
// downstream, onto the user profile at fulfillment.
type firstTouchPayload struct {
	Source   string `json:"s"`
	Medium   string `json:"m"`
	Campaign string `json:"c"`
	Content  string `json:"co"`
	Term     string `json:"t"`
	Referer  string `json:"r"`
	Path     string `json:"p"`
	TS       int64  `json:"ts"`
}

// Stripe rejects metadata values longer than 500 characters, and rejects keys
// longer than 40. Truncate defensively before we send so a cookie tampered to
// be huge can't break checkout.
const stripeMetadataValueMax = 500

func truncForStripe(v string) string {
	v = strings.TrimSpace(v)
	if len(v) > stripeMetadataValueMax {
		return v[:stripeMetadataValueMax]
	}
	return v
}

// applyToCheckoutMetadata writes ft_* keys into the Stripe checkout session
// metadata map for any non-empty fields and returns the source label used for
// the install-click counter (empty when the payload had no source — usually
// direct traffic).
func (p *firstTouchPayload) applyToCheckoutMetadata(metadata map[string]string) string {
	if p == nil {
		return ""
	}
	put := func(k, v string) {
		v = truncForStripe(v)
		if v != "" {
			metadata[k] = v
		}
	}
	put("ft_source", p.Source)
	put("ft_medium", p.Medium)
	put("ft_campaign", p.Campaign)
	put("ft_content", p.Content)
	put("ft_term", p.Term)
	put("ft_referrer", p.Referer)
	put("ft_path", p.Path)
	return strings.TrimSpace(p.Source)
}

// firstTouchFieldsFromMetadata extracts the ft_* keys from a Stripe session
// metadata map into a map suitable for HSet onto the user profile hash. Keys
// are rewritten to first_touch_* to match the gtag flattening and lander
// conventions. Returns an empty map when no first-touch fields are present.
func firstTouchFieldsFromMetadata(metadata map[string]string) map[string]any {
	out := map[string]any{}
	pairs := []struct {
		md, profile string
	}{
		{"ft_source", "first_touch_source"},
		{"ft_medium", "first_touch_medium"},
		{"ft_campaign", "first_touch_campaign"},
		{"ft_content", "first_touch_content"},
		{"ft_term", "first_touch_term"},
		{"ft_referrer", "first_touch_referrer"},
		{"ft_path", "first_touch_path"},
	}
	for _, p := range pairs {
		if v := strings.TrimSpace(metadata[p.md]); v != "" {
			out[p.profile] = v
		}
	}
	return out
}

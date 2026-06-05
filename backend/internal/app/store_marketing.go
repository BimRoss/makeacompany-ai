package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Issue #303 — UTM registry. Two key spaces, both intentionally outside the
// "makeacompany:" prefix used by other domains: the marketing tooling has its
// own lifecycle and the keys are quoted verbatim in the ticket, so keeping the
// literal prefix avoids surprises if Erika/John inspect Redis directly.
const (
	marketingCampaignKeyPrefix = "marketing:campaigns:"
	marketingCampaignIndexKey  = "marketing:campaigns:index"
)

// MarketingAllowedSources is the v1 source taxonomy. Single entry today; the
// dropdown is intentionally rendered as a <select> so adding more (twitter,
// producthunt, hn) is a one-line code change.
var MarketingAllowedSources = []string{"linkedin"}

// MarketingAllowedMediums is the v1 medium taxonomy.
var MarketingAllowedMediums = []string{"social", "email", "referral", "cpc", "community"}

// kebabRe enforces lowercase + kebab-case per the ticket. Empty is handled by
// callers (campaign required, content optional).
var marketingKebabRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ErrMarketingCampaignNotFound is returned when the id is absent from the index.
var ErrMarketingCampaignNotFound = errors.New("campaign not found")

// MarketingCampaign mirrors the JSON blob persisted at
// `marketing:campaigns:<id>`. CreatedAtMs is unix-ms (matches the sorted-set
// score); CreatedAt is the RFC3339 version for human display.
type MarketingCampaign struct {
	ID             string `json:"id"`
	Campaign       string `json:"campaign"`
	Source         string `json:"source"`
	Medium         string `json:"medium"`
	Content        string `json:"content,omitempty"`
	TargetURL      string `json:"target_url"`
	TaggedURL      string `json:"tagged_url"`
	CreatedByEmail string `json:"created_by_email"`
	CreatedAt      string `json:"created_at"`
	CreatedAtMs    int64  `json:"created_at_ms"`
}

func marketingCampaignKey(id string) string { return marketingCampaignKeyPrefix + id }

func marketingSourceAllowed(s string) bool {
	for _, v := range MarketingAllowedSources {
		if v == s {
			return true
		}
	}
	return false
}

func marketingMediumAllowed(m string) bool {
	for _, v := range MarketingAllowedMediums {
		if v == m {
			return true
		}
	}
	return false
}

// ValidateMarketingCampaign normalizes string fields in-place and returns an
// error for any field that fails the v1 rules.
func ValidateMarketingCampaign(c *MarketingCampaign) error {
	c.Campaign = strings.TrimSpace(strings.ToLower(c.Campaign))
	c.Source = strings.TrimSpace(strings.ToLower(c.Source))
	c.Medium = strings.TrimSpace(strings.ToLower(c.Medium))
	c.Content = strings.TrimSpace(strings.ToLower(c.Content))
	c.TargetURL = strings.TrimSpace(c.TargetURL)

	if c.Campaign == "" {
		return fmt.Errorf("campaign is required")
	}
	if !marketingKebabRe.MatchString(c.Campaign) {
		return fmt.Errorf("campaign must be lowercase kebab-case (e.g. 2026-06-veo-ad)")
	}
	if !marketingSourceAllowed(c.Source) {
		return fmt.Errorf("source must be one of: %s", strings.Join(MarketingAllowedSources, ", "))
	}
	if !marketingMediumAllowed(c.Medium) {
		return fmt.Errorf("medium must be one of: %s", strings.Join(MarketingAllowedMediums, ", "))
	}
	if c.Content != "" && !marketingKebabRe.MatchString(c.Content) {
		return fmt.Errorf("content must be lowercase kebab-case when set")
	}
	if c.TargetURL == "" {
		c.TargetURL = "https://makeacompany.ai/"
	}
	if !strings.HasPrefix(c.TargetURL, "http://") && !strings.HasPrefix(c.TargetURL, "https://") {
		return fmt.Errorf("target_url must start with http:// or https://")
	}
	return nil
}

// BuildMarketingTaggedURL merges the UTM params into the target URL's query
// string, preserving any existing query and fragment. Returns the input
// unchanged if parsing fails — validateMarketing checks for http(s):// prefix
// upstream, so this is mostly defensive.
func BuildMarketingTaggedURL(c MarketingCampaign) string {
	u, err := url.Parse(c.TargetURL)
	if err != nil {
		return c.TargetURL
	}
	q := u.Query()
	q.Set("utm_source", c.Source)
	q.Set("utm_medium", c.Medium)
	q.Set("utm_campaign", c.Campaign)
	if c.Content != "" {
		q.Set("utm_content", c.Content)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// SaveMarketingCampaign persists a new campaign and indexes it by creation time.
// The id is generated server-side so callers cannot collide entries.
func (s *Store) SaveMarketingCampaign(ctx context.Context, c MarketingCampaign) (MarketingCampaign, error) {
	if err := ValidateMarketingCampaign(&c); err != nil {
		return MarketingCampaign{}, err
	}
	if strings.TrimSpace(c.CreatedByEmail) == "" {
		return MarketingCampaign{}, fmt.Errorf("created_by_email is required")
	}
	id, err := randomTokenHex(16)
	if err != nil {
		return MarketingCampaign{}, err
	}
	c.ID = id
	now := time.Now().UTC()
	c.CreatedAtMs = now.UnixMilli()
	c.CreatedAt = now.Format(time.RFC3339)
	c.TaggedURL = BuildMarketingTaggedURL(c)

	blob, err := json.Marshal(c)
	if err != nil {
		return MarketingCampaign{}, err
	}

	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, marketingCampaignKey(id), blob, 0)
	pipe.ZAdd(ctx, marketingCampaignIndexKey, redis.Z{Score: float64(c.CreatedAtMs), Member: id})
	if _, err := pipe.Exec(ctx); err != nil {
		return MarketingCampaign{}, err
	}
	return c, nil
}

// ListMarketingCampaigns returns all campaigns newest-first.
func (s *Store) ListMarketingCampaigns(ctx context.Context) ([]MarketingCampaign, error) {
	ids, err := s.rdb.ZRevRange(ctx, marketingCampaignIndexKey, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []MarketingCampaign{}, nil
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = marketingCampaignKey(id)
	}
	blobs, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]MarketingCampaign, 0, len(blobs))
	for _, raw := range blobs {
		str, ok := raw.(string)
		if !ok || str == "" {
			continue
		}
		var c MarketingCampaign
		if err := json.Unmarshal([]byte(str), &c); err != nil {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

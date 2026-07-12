package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Tier-waitlist is a soft interest list (Personal Agent, Enterprise). Distinct
// from the paid Stripe waitlist (`makeacompany:waitlist:*`) — these signups
// just drop their email to be notified when their tier opens.
const tierWaitlistKeyPrefix = keyPrefix + ":tier_waitlist:"
const tierWaitlistKeyMatch = keyPrefix + ":tier_waitlist:*"

// Allowed tier slugs. Adding a new tier? Add it here and on the form.
var tierWaitlistAllowedTiers = map[string]bool{
	"solo":           true,
	"founder":        true,
	"studio":         true,
	"embedded":       true,
	"personal-agent": true,
	"enterprise":     true,
}

// ErrTierWaitlistInvalidTier is returned when the caller passes a tier slug
// that isn't on the allowlist.
var ErrTierWaitlistInvalidTier = errors.New("invalid tier")

// TierWaitlistSignup is the public shape of one stored entry.
type TierWaitlistSignup struct {
	Tier      string `json:"tier"`
	Email     string `json:"email"`
	Source    string `json:"source,omitempty"`
	CreatedAt string `json:"created_at"`
}

func tierWaitlistKey(tier, email string) string {
	return tierWaitlistKeyPrefix + tier + ":" + email
}

// SaveTierWaitlistSignup writes the email under the tier-waitlist key space.
// Idempotent on (tier, email): re-submitting refreshes the updated_at field.
// Returns ErrTierWaitlistInvalidTier when the tier isn't allowlisted.
func (s *Store) SaveTierWaitlistSignup(ctx context.Context, tier, email, source string) error {
	tier = strings.TrimSpace(strings.ToLower(tier))
	email = strings.TrimSpace(strings.ToLower(email))
	source = strings.TrimSpace(source)
	if email == "" || !strings.Contains(email, "@") {
		return fmt.Errorf("missing or invalid email")
	}
	if !tierWaitlistAllowedTiers[tier] {
		return ErrTierWaitlistInvalidTier
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := tierWaitlistKey(tier, email)

	fields := map[string]any{
		"tier":       tier,
		"email":      email,
		"source":     source,
		"updated_at": now,
	}
	// Only set created_at on first write so we keep first-seen.
	exists, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis exists: %w", err)
	}
	if exists == 0 {
		fields["created_at"] = now
	}
	if err := s.rdb.HSet(ctx, key, fields).Err(); err != nil {
		return fmt.Errorf("redis hset: %w", err)
	}
	return nil
}

// ListTierWaitlistSignups returns all entries, optionally filtered by tier
// (empty = all). Ordered newest-first by created_at.
func (s *Store) ListTierWaitlistSignups(ctx context.Context, tier string) ([]TierWaitlistSignup, error) {
	tier = strings.TrimSpace(strings.ToLower(tier))
	match := tierWaitlistKeyMatch
	if tier != "" {
		if !tierWaitlistAllowedTiers[tier] {
			return nil, ErrTierWaitlistInvalidTier
		}
		match = tierWaitlistKeyPrefix + tier + ":*"
	}
	var (
		cursor uint64
		keys   []string
	)
	for {
		batch, next, err := s.rdb.Scan(ctx, cursor, match, 200).Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				break
			}
			return nil, fmt.Errorf("redis scan: %w", err)
		}
		keys = append(keys, batch...)
		if next == 0 {
			break
		}
		cursor = next
		if len(keys) >= maxWaitlistList {
			break
		}
	}
	out := make([]TierWaitlistSignup, 0, len(keys))
	for _, k := range keys {
		h, err := s.rdb.HGetAll(ctx, k).Result()
		if err != nil {
			continue
		}
		out = append(out, TierWaitlistSignup{
			Tier:      h["tier"],
			Email:     h["email"],
			Source:    h["source"],
			CreatedAt: h["created_at"],
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

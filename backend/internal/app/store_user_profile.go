package app

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis keys: makeacompany:user_profile:<normalized_email> (HASH),
// makeacompany:user_by_slack:<slack_user_id> (STRING -> normalized email).
const (
	userProfileKeyGlob   = keyPrefix + ":user_profile:*"
	userBySlackKeyPrefix = keyPrefix + ":user_by_slack:"
	maxUserProfileList   = 500
)

func normalizeProfileEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func userProfileRedisKey(email string) string {
	return fmt.Sprintf("%s:user_profile:%s", keyPrefix, normalizeProfileEmail(email))
}

func userBySlackRedisKey(slackUserID string) string {
	return userBySlackKeyPrefix + strings.TrimSpace(slackUserID)
}

// UpsertUserProfileAfterWaitlist merges Stripe waitlist fields into the canonical profile hash.
// stripeProductID is written only when non-empty so callers without line-item data do not clear an existing value.
func (s *Store) UpsertUserProfileAfterWaitlist(ctx context.Context, email, stripeCustomer, stripeSessionID, paymentStatus, stripeProductID string) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"email":                   email,
		"stripe_customer_id":      strings.TrimSpace(stripeCustomer),
		"stripe_session_id":       strings.TrimSpace(stripeSessionID),
		"waitlist_payment_status": strings.TrimSpace(paymentStatus),
		"profile_updated_at":      now,
	}
	if pid := strings.TrimSpace(stripeProductID); pid != "" {
		fields["stripe_product_id"] = pid
	}
	return s.rdb.HSet(ctx, userProfileRedisKey(email), fields).Err()
}

// UpsertUserProfileStripeSubscription updates subscription-derived fields on the profile hash.
// stripeProductID is set only when non-empty (same as waitlist upsert) so a payload without an expanded price.product does not erase a previously stored product.
func (s *Store) UpsertUserProfileStripeSubscription(ctx context.Context, email, stripeCustomerID, subscriptionID, subscriptionStatus, tier, priceID, stripeProductID string) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"email":                          email,
		"stripe_customer_id":             strings.TrimSpace(stripeCustomerID),
		"stripe_subscription_id":         strings.TrimSpace(subscriptionID),
		"stripe_subscription_status":     strings.TrimSpace(subscriptionStatus),
		"stripe_price_id":                strings.TrimSpace(priceID),
		"tier":                           strings.TrimSpace(tier),
		"stripe_subscription_updated_at": now,
		"profile_updated_at":             now,
	}
	if pid := strings.TrimSpace(stripeProductID); pid != "" {
		fields["stripe_product_id"] = pid
	}
	return s.rdb.HSet(ctx, userProfileRedisKey(email), fields).Err()
}

// UpsertUserProfileSlackID sets Slack user id for a profile and maintains slack->email index.
func (s *Store) UpsertUserProfileSlackID(ctx context.Context, email, slackUserID string) error {
	email = normalizeProfileEmail(email)
	slackUserID = strings.TrimSpace(slackUserID)
	if email == "" || slackUserID == "" {
		return fmt.Errorf("missing email or slack user id")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := userProfileRedisKey(email)
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, key, map[string]any{
		"email":                    email,
		"slack_user_id":            slackUserID,
		"slack_profile_updated_at": now,
		"profile_updated_at":       now,
	})
	pipe.Set(ctx, userBySlackRedisKey(slackUserID), email, 0)
	_, err := pipe.Exec(ctx)
	return err
}

// SyncSlackUserIndexFromWorkspaceUsers writes makeacompany:user_by_slack:<id> and profile slack fields
// for each non-bot, non-deleted member with a visible email (Slack users.list). This aligns the Redis
// index used by employee-factory (Joanne email default recipient) with the admin Slack Users snapshot.
func (s *Store) SyncSlackUserIndexFromWorkspaceUsers(ctx context.Context, users []SlackWorkspaceUser) (synced int, err error) {
	if s == nil {
		return 0, fmt.Errorf("nil store")
	}
	for _, u := range users {
		if u.IsBot || u.IsDeleted {
			continue
		}
		sid := strings.TrimSpace(u.SlackUserID)
		em := normalizeProfileEmail(strings.TrimSpace(u.Email))
		if sid == "" || em == "" || !strings.Contains(em, "@") {
			continue
		}
		if err := s.UpsertUserProfileSlackID(ctx, em, sid); err != nil {
			return synced, fmt.Errorf("upsert slack index for %s: %w", sid, err)
		}
		synced++
	}
	return synced, nil
}

// UpsertUserProfilesFromStripeWaitlistPurchasers merges each paid waitlist row into makeacompany:user_profile:<email>.
// Call after Stripe snapshot/live fetches so profile hashes match checkout without relying only on webhooks.
func (s *Store) UpsertUserProfilesFromStripeWaitlistPurchasers(ctx context.Context, purchasers []StripeWaitlistPurchaser) (n int, err error) {
	if s == nil {
		return 0, fmt.Errorf("nil store")
	}
	for _, p := range purchasers {
		email := normalizeProfileEmail(strings.TrimSpace(p.Email))
		if email == "" {
			continue
		}
		if err := s.UpsertUserProfileAfterWaitlist(ctx, email, strings.TrimSpace(p.StripeCustomer), strings.TrimSpace(p.StripeSessionID), strings.TrimSpace(p.PaymentStatus), strings.TrimSpace(p.StripeProductID)); err != nil {
			return n, fmt.Errorf("waitlist profile %s: %w", email, err)
		}
		n++
	}
	return n, nil
}

// UserProfileRow is one combined profile for admin UI and integrations.
type UserProfileRow struct {
	Email                       string `json:"email"`
	StripeCustomerID            string `json:"stripeCustomerId"`
	StripeSubscriptionID        string `json:"stripeSubscriptionId"`
	StripeSubscriptionStatus    string `json:"stripeSubscriptionStatus"`
	StripePriceID               string `json:"stripePriceId"`
	StripeSessionID             string `json:"stripeSessionId"`
	StripeProductID             string `json:"stripeProductId"`
	Tier                        string `json:"tier"`
	SlackUserID                 string `json:"slackUserId"`
	WaitlistPaymentStatus       string `json:"waitlistPaymentStatus"`
	ProfileUpdatedAt            string `json:"profileUpdatedAt"`
	SlackProfileUpdatedAt       string `json:"slackProfileUpdatedAt"`
	StripeSubscriptionUpdatedAt string `json:"stripeSubscriptionUpdatedAt"`
	Linked                      bool   `json:"linked"`
}

// ListUserProfiles scans profile hashes (PII). Newest profile_updated_at first; capped at maxUserProfileList.
func (s *Store) ListUserProfiles(ctx context.Context) ([]UserProfileRow, error) {
	var rows []UserProfileRow
	var cursor uint64
outer:
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, userProfileKeyGlob, 64).Result()
		if err != nil {
			return nil, err
		}
		for _, redisKey := range keys {
			if len(rows) >= maxUserProfileList {
				break outer
			}
			vals, err := s.rdb.HGetAll(ctx, redisKey).Result()
			if err != nil {
				return nil, err
			}
			if len(vals) == 0 {
				continue
			}
			email := normalizeProfileEmail(vals["email"])
			if email == "" {
				if i := strings.LastIndex(redisKey, ":user_profile:"); i >= 0 {
					email = normalizeProfileEmail(redisKey[i+len(":user_profile:"):])
				}
			}
			stripeCust := strings.TrimSpace(vals["stripe_customer_id"])
			slackID := strings.TrimSpace(vals["slack_user_id"])
			rows = append(rows, UserProfileRow{
				Email:                       email,
				StripeCustomerID:            stripeCust,
				StripeSubscriptionID:        strings.TrimSpace(vals["stripe_subscription_id"]),
				StripeSubscriptionStatus:    strings.TrimSpace(vals["stripe_subscription_status"]),
				StripePriceID:               strings.TrimSpace(vals["stripe_price_id"]),
				StripeSessionID:             strings.TrimSpace(vals["stripe_session_id"]),
				StripeProductID:             strings.TrimSpace(vals["stripe_product_id"]),
				Tier:                        strings.TrimSpace(vals["tier"]),
				SlackUserID:                 slackID,
				WaitlistPaymentStatus:       strings.TrimSpace(vals["waitlist_payment_status"]),
				ProfileUpdatedAt:            strings.TrimSpace(vals["profile_updated_at"]),
				SlackProfileUpdatedAt:       strings.TrimSpace(vals["slack_profile_updated_at"]),
				StripeSubscriptionUpdatedAt: strings.TrimSpace(vals["stripe_subscription_updated_at"]),
				Linked:                      stripeCust != "" && slackID != "",
			})
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		ti, _ := time.Parse(time.RFC3339, rows[i].ProfileUpdatedAt)
		tj, _ := time.Parse(time.RFC3339, rows[j].ProfileUpdatedAt)
		if ti.IsZero() && tj.IsZero() {
			return rows[i].Email < rows[j].Email
		}
		if ti.IsZero() {
			return false
		}
		if tj.IsZero() {
			return true
		}
		return ti.After(tj)
	})
	return rows, nil
}

// UserProfileTierBySlackUser returns the stored tier for a Slack user id via the slack->email index, or "" if unknown.
func (s *Store) UserProfileTierBySlackUser(ctx context.Context, slackUserID string) (email, tier string, err error) {
	slackUserID = strings.TrimSpace(slackUserID)
	if slackUserID == "" {
		return "", "", nil
	}
	emailKey, err := s.rdb.Get(ctx, userBySlackRedisKey(slackUserID)).Result()
	if err == redis.Nil {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	email = normalizeProfileEmail(emailKey)
	if email == "" {
		return "", "", nil
	}
	t, err := s.rdb.HGet(ctx, userProfileRedisKey(email), "tier").Result()
	if err == redis.Nil {
		return email, "", nil
	}
	if err != nil {
		return email, "", err
	}
	return email, strings.TrimSpace(t), nil
}

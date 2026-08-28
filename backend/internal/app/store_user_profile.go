package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
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
// stripeProductID and attributedTo are written only when non-empty so callers without those values do not clear existing data.
func (s *Store) UpsertUserProfileAfterWaitlist(ctx context.Context, email, stripeCustomer, stripeSessionID, paymentStatus, stripeProductID, attributedTo string) error {
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
	if ref := strings.TrimSpace(attributedTo); ref != "" {
		fields["attributed_to"] = ref
	}
	return stampSignupAtAndHSet(ctx, s.rdb, userProfileRedisKey(email), now, fields)
}

// UpsertUserProfileFreeTrialInvite records a free-trial invite request on the profile hash without
// touching Stripe-derived fields (so re-submitting from a logged-in browser can't clobber paid data).
// attributedTo is written only when non-empty for the same reason as the waitlist path.
//
// When trialExpiresAtUnix > 0, the upsert also marks the user as trialing (stripe_subscription_status="trialing"
// and trial_expires_at=<unix>), which is the post-100-cliff path. When 0, no lifecycle fields are written and
// the user remains in their existing state — that's the pre-cliff path where signup grants free_lifetime via
// the seat-count backfill in scripts/backfill-free-lifetime.sh.
func (s *Store) UpsertUserProfileFreeTrialInvite(ctx context.Context, email, attributedTo string, trialExpiresAtUnix int64) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"email":                     email,
		"free_trial_invite_sent_at": now,
		"profile_updated_at":        now,
	}
	if ref := strings.TrimSpace(attributedTo); ref != "" {
		fields["attributed_to"] = ref
	}
	if trialExpiresAtUnix > 0 {
		fields["stripe_subscription_status"] = "trialing"
		fields["trial_expires_at"] = strconv.FormatInt(trialExpiresAtUnix, 10)
	}
	return stampSignupAtAndHSet(ctx, s.rdb, userProfileRedisKey(email), now, fields)
}

// MergeUserProfileFields HSets caller-supplied fields onto the profile hash without touching any other keys.
// Skips the write when fields is empty. Stamps profile_updated_at and email so the row remains queryable.
// Used by the funnel-tracking path to layer first_touch_* attribution onto the existing waitlist profile
// without forcing every prior caller of UpsertUserProfileAfterWaitlist to thread a new arg through.
func (s *Store) MergeUserProfileFields(ctx context.Context, email string, fields map[string]any) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if len(fields) == 0 {
		return nil
	}
	out := make(map[string]any, len(fields)+2)
	for k, v := range fields {
		out[k] = v
	}
	out["email"] = email
	out["profile_updated_at"] = time.Now().UTC().Format(time.RFC3339)
	return s.rdb.HSet(ctx, userProfileRedisKey(email), out).Err()
}

// MarkProfileFreeLifetime stamps free_lifetime=true on the profile hash. Used by the first-100-users backfill
// (see scripts/backfill-free-lifetime.sh) and by any future signup path that decides at write time the user
// falls under the cliff.
func (s *Store) MarkProfileFreeLifetime(ctx context.Context, email string) error {
	return s.SetProfileFreeLifetime(ctx, email, true)
}

// SetProfileFreeLifetime sets (or clears) free_lifetime on the profile hash. Clearing writes "false"
// rather than deleting the field so EffectiveStatus reads it unambiguously and the change is auditable.
// Powers the /admin Slack-users status control (admin can mark a user free-for-life or revert it).
func (s *Store) SetProfileFreeLifetime(ctx context.Context, email string, freeLifetime bool) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	return stampSignupAtAndHSet(ctx, s.rdb, userProfileRedisKey(email), now, map[string]any{
		"email":              email,
		"free_lifetime":      strconv.FormatBool(freeLifetime),
		"profile_updated_at": now,
	})
}

// stampSignupAtAndHSet writes the per-profile fields and, in the same pipeline,
// HSetNX-stamps signup_at on first write so it sticks forever. signup_at is the
// signup anchor for TTFV (issue #579); we never let a later upsert clobber it.
func stampSignupAtAndHSet(ctx context.Context, rdb *redis.Client, key, nowRFC3339 string, fields map[string]any) error {
	pipe := rdb.TxPipeline()
	pipe.HSetNX(ctx, key, "signup_at", nowRFC3339)
	pipe.HSet(ctx, key, fields)
	_, err := pipe.Exec(ctx)
	return err
}

// UpsertUserProfileStripeSubscription updates subscription-derived fields on the profile hash.
// stripeProductID is set only when non-empty (same as waitlist upsert) so a payload without an expanded price.product does not erase a previously stored product.
func (s *Store) UpsertUserProfileStripeSubscription(ctx context.Context, email, stripeCustomerID, subscriptionID, subscriptionStatus, tier, priceID, stripeProductID string, cancelAtPeriodEnd bool, currentPeriodEndUnix int64) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	fields := map[string]any{
		"email":                      email,
		"stripe_customer_id":         strings.TrimSpace(stripeCustomerID),
		"stripe_subscription_id":     strings.TrimSpace(subscriptionID),
		"stripe_subscription_status": strings.TrimSpace(subscriptionStatus),
		"stripe_price_id":            strings.TrimSpace(priceID),
		"tier":                       strings.TrimSpace(tier),
		"stripe_subscription_cancel_at_period_end": strconv.FormatBool(cancelAtPeriodEnd),
		"stripe_subscription_updated_at":           now,
		"profile_updated_at":                       now,
	}
	if currentPeriodEndUnix > 0 {
		fields["stripe_subscription_current_period_end"] = strconv.FormatInt(currentPeriodEndUnix, 10)
	}
	if pid := strings.TrimSpace(stripeProductID); pid != "" {
		fields["stripe_product_id"] = pid
	}
	key := userProfileRedisKey(email)
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, key, fields)
	// When a sub flips to active, the lander-side trial deadline is no longer load-bearing — clear it so
	// admin (#245) doesn't display "trial ends in 3d" next to a paying customer and so EffectiveStatus
	// readers see clean data. We keep free_lifetime intact: a paid user who later cancels falls back to
	// their pre-cliff free_lifetime state, not to expired.
	if strings.EqualFold(strings.TrimSpace(subscriptionStatus), "active") {
		pipe.HDel(ctx, key, "trial_expires_at")
	}
	_, err := pipe.Exec(ctx)
	return err
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

func stripePurchaserProfileUpsertRank(role string) int {
	switch strings.TrimSpace(role) {
	case StripeCheckoutPriceRoleWaitlistDeposit, "":
		return 0
	case StripeCheckoutPriceRoleBasePlan:
		return 1
	default:
		return 0
	}
}

// UpsertUserProfilesFromStripeWaitlistPurchasers merges each paid checkout row into makeacompany:user_profile:<email>.
// Call after Stripe snapshot/live fetches so profile hashes match checkout without relying only on webhooks.
// When the same email appears for waitlist deposit and base plan, base plan rows are applied last so subscription/checkout wins.
func (s *Store) UpsertUserProfilesFromStripeWaitlistPurchasers(ctx context.Context, purchasers []StripeWaitlistPurchaser) (n int, err error) {
	if s == nil {
		return 0, fmt.Errorf("nil store")
	}
	ordered := append([]StripeWaitlistPurchaser(nil), purchasers...)
	sort.Slice(ordered, func(i, j int) bool {
		ri := stripePurchaserProfileUpsertRank(ordered[i].PriceRole)
		rj := stripePurchaserProfileUpsertRank(ordered[j].PriceRole)
		if ri != rj {
			return ri < rj
		}
		ti, _ := time.Parse(time.RFC3339, ordered[i].CheckoutCreated)
		tj, _ := time.Parse(time.RFC3339, ordered[j].CheckoutCreated)
		if ti.Equal(tj) {
			return ordered[i].Email < ordered[j].Email
		}
		return ti.Before(tj)
	})
	for _, p := range ordered {
		email := normalizeProfileEmail(strings.TrimSpace(p.Email))
		if email == "" {
			continue
		}
		if err := s.UpsertUserProfileAfterWaitlist(ctx, email, strings.TrimSpace(p.StripeCustomer), strings.TrimSpace(p.StripeSessionID), strings.TrimSpace(p.PaymentStatus), strings.TrimSpace(p.StripeProductID), ""); err != nil {
			return n, fmt.Errorf("waitlist profile %s: %w", email, err)
		}
		n++
	}
	return n, nil
}

// UserProfileRow is one combined profile for admin UI and integrations.
type UserProfileRow struct {
	Email                    string `json:"email"`
	StripeCustomerID         string `json:"stripeCustomerId"`
	StripeSubscriptionID     string `json:"stripeSubscriptionId"`
	StripeSubscriptionStatus string `json:"stripeSubscriptionStatus"`
	StripePriceID            string `json:"stripePriceId"`
	StripeSessionID          string `json:"stripeSessionId"`
	StripeProductID          string `json:"stripeProductId"`
	Tier                     string `json:"tier"`
	SlackUserID              string `json:"slackUserId"`
	WaitlistPaymentStatus    string `json:"waitlistPaymentStatus"`
	// SignupAt is the RFC3339 stamp of the user's first profile-creation write
	// (waitlist purchase, free-trial invite, or free-lifetime mark). Written
	// once via HSetNX so later upserts cannot move it forward. Anchor for TTFV
	// (#579).
	SignupAt                            string `json:"signupAt,omitempty"`
	ProfileUpdatedAt                    string `json:"profileUpdatedAt"`
	SlackProfileUpdatedAt               string `json:"slackProfileUpdatedAt"`
	StripeSubscriptionUpdatedAt         string `json:"stripeSubscriptionUpdatedAt"`
	StripeSubscriptionCancelAtPeriodEnd bool   `json:"stripeSubscriptionCancelAtPeriodEnd,omitempty"`
	StripeSubscriptionCurrentPeriodEnd  int64  `json:"stripeSubscriptionCurrentPeriodEnd,omitempty"`
	HumansTermsAcceptedAt               string `json:"humansTermsAcceptedAt,omitempty"`
	HumansTermsAcceptedMessageTs        string `json:"humansTermsAcceptedMessageTs,omitempty"`
	// FreeTierConsumed is set when a free (unpaid) user ships their first deployment.
	// Once true, Joanne blocks further deploys until the user subscribes via Stripe.
	FreeTierConsumed bool   `json:"freeTierConsumed,omitempty"`
	AttributedTo     string `json:"attributedTo,omitempty"`
	Linked           bool   `json:"linked"`
	// FreeLifetime is true for users who landed pre-100-cliff. Backfilled by scripts/backfill-free-lifetime.sh
	// and respected by EffectiveStatus so they never flip to expired regardless of Stripe state.
	FreeLifetime bool `json:"freeLifetime,omitempty"`
	// TrialExpiresAt is the unix-second deadline for the post-cliff 10-day trial. 0 when not trialing.
	TrialExpiresAt int64 `json:"trialExpiresAt,omitempty"`
	// ExpiryDMEnqueuedAt is the RFC3339 timestamp the trial-expiry reaper pushed the Joanne-side DM job
	// for this user. Non-empty means the reaper has already queued; #244 uses this as the idempotency
	// guard so a slow Joanne drain (or a flapping cron) doesn't fan out duplicate DMs.
	ExpiryDMEnqueuedAt string `json:"expiryDmEnqueuedAt,omitempty"`
	// WinbackDMEnqueuedAt is the RFC3339 timestamp the cancel-webhook path pushed a winback DM
	// onto the Joanne queue. Non-empty means we've already DM'd them about the cancel; subsequent
	// subscription.updated/deleted webhooks are no-ops for the DM side. #341 uses this as the
	// idempotency guard.
	WinbackDMEnqueuedAt string `json:"winbackDmEnqueuedAt,omitempty"`
	// Day7CheckinEnqueuedAt is the RFC3339 timestamp the day-7 checkin reaper pushed the Joanne
	// DM job onto the Joanne queue for this user. Non-empty means we've already DM'd them — the
	// reaper uses this as the idempotency guard so a flapping cron doesn't fan out duplicates.
	// See #616.
	Day7CheckinEnqueuedAt string `json:"day7CheckinEnqueuedAt,omitempty"`
	// Day7CheckinResponse is whatever Joanne wrote back after the user replied to the day-7 DM
	// (free text summary, e.g. "named Sarah at sarah@x.com, sent invite"). Empty means no
	// reply yet or no response was salvaged. Surfaced by the daily sales briefing.
	Day7CheckinResponse string `json:"day7CheckinResponse,omitempty"`

	// Claude BYOK (#773): last4 + updatedAt are safe display metadata for /me.
	// The ciphertext itself is deliberately NOT carried on the row — read it via
	// Store.UserClaudeKeyCiphertext so it can never leak into a JSON response.
	ClaudeAPIKeyLast4     string `json:"claudeApiKeyLast4,omitempty"`
	ClaudeAPIKeyUpdatedAt string `json:"claudeApiKeyUpdatedAt,omitempty"`

	// Credit metering (#797). CreditsBalance is the remaining spendable balance;
	// CreditsUnlimited is the admin comp flag. Granted/Consumed totals are audit
	// counters. Zero-value fields mean the profile has not been seeded yet.
	CreditsBalance       int64  `json:"creditsBalance"`
	CreditsGrantedTotal  int64  `json:"creditsGrantedTotal,omitempty"`
	CreditsConsumedTotal int64  `json:"creditsConsumedTotal,omitempty"`
	CreditsUnlimited     bool   `json:"creditsUnlimited,omitempty"`
	CreditsLastGrantAt   string `json:"creditsLastGrantAt,omitempty"`
	SlackTeamID          string `json:"slackTeamId,omitempty"`
}

func parseUnixSecondsString(v string) int64 {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// userProfileRowFromHash maps Redis HGETALL fields into UserProfileRow (email is the canonical lookup key when hash lacks email).
func userProfileRowFromHash(email string, vals map[string]string) UserProfileRow {
	email = normalizeProfileEmail(email)
	if em := normalizeProfileEmail(vals["email"]); em != "" {
		email = em
	}
	stripeCust := strings.TrimSpace(vals["stripe_customer_id"])
	slackID := strings.TrimSpace(vals["slack_user_id"])
	cancelAtEnd := strings.EqualFold(strings.TrimSpace(vals["stripe_subscription_cancel_at_period_end"]), "true")
	freeTierConsumed := strings.EqualFold(strings.TrimSpace(vals["free_tier_consumed"]), "true")
	freeLifetime := strings.EqualFold(strings.TrimSpace(vals["free_lifetime"]), "true")
	return UserProfileRow{
		Email:                               email,
		StripeCustomerID:                    stripeCust,
		StripeSubscriptionID:                strings.TrimSpace(vals["stripe_subscription_id"]),
		StripeSubscriptionStatus:            strings.TrimSpace(vals["stripe_subscription_status"]),
		StripePriceID:                       strings.TrimSpace(vals["stripe_price_id"]),
		StripeSessionID:                     strings.TrimSpace(vals["stripe_session_id"]),
		StripeProductID:                     strings.TrimSpace(vals["stripe_product_id"]),
		Tier:                                strings.TrimSpace(vals["tier"]),
		SlackUserID:                         slackID,
		WaitlistPaymentStatus:               strings.TrimSpace(vals["waitlist_payment_status"]),
		SignupAt:                            strings.TrimSpace(vals["signup_at"]),
		ProfileUpdatedAt:                    strings.TrimSpace(vals["profile_updated_at"]),
		SlackProfileUpdatedAt:               strings.TrimSpace(vals["slack_profile_updated_at"]),
		StripeSubscriptionUpdatedAt:         strings.TrimSpace(vals["stripe_subscription_updated_at"]),
		StripeSubscriptionCancelAtPeriodEnd: cancelAtEnd,
		StripeSubscriptionCurrentPeriodEnd:  parseUnixSecondsString(vals["stripe_subscription_current_period_end"]),
		HumansTermsAcceptedAt:               strings.TrimSpace(vals["humans_terms_accepted_at"]),
		HumansTermsAcceptedMessageTs:        strings.TrimSpace(vals["humans_terms_accepted_slack_message_ts"]),
		FreeTierConsumed:                    freeTierConsumed,
		AttributedTo:                        strings.TrimSpace(vals["attributed_to"]),
		Linked:                              stripeCust != "" && slackID != "",
		FreeLifetime:                        freeLifetime,
		TrialExpiresAt:                      parseUnixSecondsString(vals["trial_expires_at"]),
		ExpiryDMEnqueuedAt:                  strings.TrimSpace(vals["expiry_dm_enqueued_at"]),
		WinbackDMEnqueuedAt:                 strings.TrimSpace(vals["winback_dm_enqueued_at"]),
		Day7CheckinEnqueuedAt:               strings.TrimSpace(vals["day7_checkin_enqueued_at"]),
		Day7CheckinResponse:                 strings.TrimSpace(vals["day7_checkin_response"]),
		ClaudeAPIKeyLast4:                   strings.TrimSpace(vals["claude_api_key_last4"]),
		ClaudeAPIKeyUpdatedAt:               strings.TrimSpace(vals["claude_api_key_updated_at"]),
		CreditsBalance:                      parseInt64String(vals["credits_balance"]),
		CreditsGrantedTotal:                 parseInt64String(vals["credits_granted_total"]),
		CreditsConsumedTotal:                parseInt64String(vals["credits_consumed_total"]),
		CreditsUnlimited:                    strings.EqualFold(strings.TrimSpace(vals["credits_unlimited"]), "true"),
		CreditsLastGrantAt:                  strings.TrimSpace(vals["credits_last_grant_at"]),
		SlackTeamID:                         strings.TrimSpace(vals["slack_team_id"]),
	}
}

// UserProfileRowByEmail loads one profile hash by normalized email.
func (s *Store) UserProfileRowByEmail(ctx context.Context, email string) (UserProfileRow, error) {
	if s == nil {
		return UserProfileRow{}, fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return UserProfileRow{}, fmt.Errorf("missing email")
	}
	vals, err := s.rdb.HGetAll(ctx, userProfileRedisKey(email)).Result()
	if err != nil {
		return UserProfileRow{}, err
	}
	return userProfileRowFromHash(email, vals), nil
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
			rows = append(rows, userProfileRowFromHash(email, vals))
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

// SlackUserIDByProfileEmail returns slack_user_id from the profile hash, or "" if missing/unknown.
func (s *Store) SlackUserIDByProfileEmail(ctx context.Context, email string) (string, error) {
	if s == nil {
		return "", fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return "", nil
	}
	v, err := s.rdb.HGet(ctx, userProfileRedisKey(email), "slack_user_id").Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(v), nil
}

// SetFreeTierConsumed marks the user's free deploy allotment as used. Idempotent.
// Called by the deploy-gate consume endpoint after Joanne confirms a deploy action completed successfully.
func (s *Store) SetFreeTierConsumed(ctx context.Context, email string) error {
	if s == nil {
		return fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	return s.rdb.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"free_tier_consumed": "true",
		"profile_updated_at": now,
	}).Err()
}

// CountFreeLifetimeProfiles returns the number of user_profile hashes with free_lifetime=true.
// O(N) over the profile keyspace, capped by SCAN at maxUserProfileList. Used by the post-100
// trial-start trigger (#325) to decide whether a fresh profile becomes free_lifetime or trialing.
func (s *Store) CountFreeLifetimeProfiles(ctx context.Context) (int, error) {
	if s == nil {
		return 0, fmt.Errorf("nil store")
	}
	var n int
	var cursor uint64
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, userProfileKeyGlob, 64).Result()
		if err != nil {
			return 0, err
		}
		for _, k := range keys {
			v, err := s.rdb.HGet(ctx, k, "free_lifetime").Result()
			if err == redis.Nil {
				continue
			}
			if err != nil {
				return 0, err
			}
			if strings.EqualFold(strings.TrimSpace(v), "true") {
				n++
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return n, nil
}

// LifecycleStatus is the resolved subscription/trial state used by the agent-silence dispatch gate (#243).
// It collapses Stripe state, the free-lifetime flag, and trial expiry into a single value so callers don't
// duplicate the precedence rules.
type LifecycleStatus string

const (
	LifecycleFreeLifetime LifecycleStatus = "free_lifetime"
	LifecycleTrialing     LifecycleStatus = "trialing"
	LifecycleActive       LifecycleStatus = "active"
	LifecycleExpired      LifecycleStatus = "expired"
	// LifecycleExcluded marks a profile that is not a MaC member at all — e.g. a foreign-product Stripe
	// orphan (a customer of another product on the shared BimRoss Stripe account, like cycler.io). It is
	// not one of the four real cohorts; the lifecycle sweeper skips it so it never appears on the chart.
	// EffectiveStatus only ever returns this for a row with no Slack identity, so it is never produced for
	// a profile reachable via the internal user-status gate (those are always looked up by Slack id).
	LifecycleExcluded LifecycleStatus = "excluded"
)

// EffectiveStatus collapses StripeSubscriptionStatus, FreeLifetime, and TrialExpiresAt into one lifecycle
// value. Precedence: Stripe active wins over everything (handles trial→paid). Then free_lifetime (the
// pre-100 cliff — preserved on cancel, see store_user_profile.go:133-135). Then any terminal Stripe
// status (canceled / incomplete_expired / unpaid) silences the user. Then a trial gates trialing vs
// expired — but only for a profile with a Slack identity; a trial-only profile that never joined the
// workspace (the free-trial-invite email form mints these, and bots spam it) is LifecycleExcluded, not
// counted in any cohort. Default is free_lifetime — the conservative choice so unknown profiles don't
// get silenced when #243 lands.
//
// basePlanProductID, when non-empty, restricts Stripe state to subscriptions on the MaC base-plan
// product. Rows whose StripeProductID is set to a different product are treated as if Stripe weren't
// configured at all — the BimRoss Stripe account hosts other products (older landers, etc.) whose
// active subscriptions would otherwise inflate the paying count. See #485. When basePlanProductID is
// empty (boot race or unconfigured local dev) or when row.StripeProductID is empty (legacy rows pre-
// dating the product_id field), behavior is unchanged from before #485.
//
// One refinement on top of #485: a profile whose Stripe footprint is a *known foreign product* (its
// StripeProductID is set and differs from the base plan) and that has no Slack identity is not a MaC
// member at all — it's a customer of another product on the shared Stripe account (e.g. cycler.io
// subscription webhooks) whose profile got minted into the store. #485 stopped these from inflating the
// *paying* count by blanking their Stripe state, but that pushed them into the conservative
// free_lifetime default below, where they inflated the *free-for-life* cohort instead (the over-count
// audit: ~40 such orphans on prod_UFoe…/prod_HcfK… showed up as free-for-life). These are not a real
// cohort — not free-for-life, and not churned MaC members either — so EffectiveStatus returns
// LifecycleExcluded and the sweeper drops them rather than counting them as expired. This is
// deliberately narrow: a foreign-product buyer who *is* in the workspace (SlackUserID set) still gets
// the conservative free_lifetime default, and a row with no product id at all — including the empty-row
// probe handleInternalUserStatus uses for unrecognized users — is untouched, so the gate never silences
// someone we don't recognize.
func EffectiveStatus(row UserProfileRow, now time.Time, basePlanProductID string) LifecycleStatus {
	st := strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus))
	if !stripeStateMatchesBasePlan(row, basePlanProductID) {
		st = ""
	}
	if st == "active" {
		return LifecycleActive
	}
	if row.FreeLifetime {
		return LifecycleFreeLifetime
	}
	// Post-cliff users who paid and then canceled (or whose subscription terminated for any
	// non-recoverable reason) must NOT fall through to free_lifetime. Without this branch they'd
	// get free service forever simply by virtue of canceling. See #341 for the audit.
	switch st {
	case "canceled", "incomplete_expired", "unpaid":
		return LifecycleExpired
	}
	if row.TrialExpiresAt > 0 {
		// A trial only counts as a real cohort member once they've joined the workspace. The
		// free-trial-invite endpoint mints a profile from an email-form submission before (and often
		// without) any Slack join, and it's a magnet for bot/spam signups (disposable domains, malformed
		// addresses). Without a Slack identity it's not an activated trial user — exclude it from the
		// cohorts entirely rather than count it as trialing/expired. A trial row is never reachable via the
		// internal user-status gate without a Slack id, so this is metric-only.
		if row.SlackUserID == "" {
			return LifecycleExcluded
		}
		if now.Unix() < row.TrialExpiresAt {
			return LifecycleTrialing
		}
		return LifecycleExpired
	}
	if st == "trialing" {
		if row.SlackUserID == "" {
			return LifecycleExcluded
		}
		return LifecycleTrialing
	}
	// Known foreign-product orphan with no Slack identity: a customer of another BimRoss Stripe
	// product (e.g. cycler.io), not a MaC member. Exclude it from the cohorts entirely — it is neither
	// free-for-life nor an expired MaC user. See the doc comment above and #485. stripeStateMatchesBasePlan
	// is false only when basePlanProductID and row.StripeProductID are both set and differ, so the
	// empty-row gate probe stays free_lifetime.
	if row.SlackUserID == "" && !stripeStateMatchesBasePlan(row, basePlanProductID) {
		return LifecycleExcluded
	}
	return LifecycleFreeLifetime
}

// stripeStateMatchesBasePlan reports whether the row's Stripe state should be honored for MaC
// lifecycle purposes. Returns true when basePlanProductID is empty (no filter configured), when
// row.StripeProductID is empty (legacy row, can't tell — be lenient), or when the two match.
// See #485.
func stripeStateMatchesBasePlan(row UserProfileRow, basePlanProductID string) bool {
	base := strings.TrimSpace(basePlanProductID)
	if base == "" {
		return true
	}
	rowProd := strings.TrimSpace(row.StripeProductID)
	if rowProd == "" {
		return true
	}
	return rowProd == base
}

// DeployGateStatus describes whether a user may ship a deployment.
type DeployGateStatus struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"` // "gate_disabled" | "paid" | "free_tier_available" | "free_tier_consumed"
}

// CheckDeployGate returns whether the user is allowed to ship based on subscription and free-tier state.
// When gateEnabled is false, always allows (the gate can ship to prod before being turned on).
//
// basePlanProductID, when non-empty, requires the row's StripeProductID to match it before honoring
// an active/trialing Stripe status. Without the filter, a paying subscription on a non-MaC BimRoss
// product would slip through the gate; see #485.
func CheckDeployGate(row UserProfileRow, gateEnabled bool, basePlanProductID string) DeployGateStatus {
	if !gateEnabled {
		return DeployGateStatus{Allowed: true, Reason: "gate_disabled"}
	}
	if stripeStateMatchesBasePlan(row, basePlanProductID) {
		switch strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus)) {
		case "active", "trialing":
			return DeployGateStatus{Allowed: true, Reason: "paid"}
		}
	}
	if !row.FreeTierConsumed {
		return DeployGateStatus{Allowed: true, Reason: "free_tier_available"}
	}
	return DeployGateStatus{Allowed: false, Reason: "free_tier_consumed"}
}

// JoanneExpiryDMQueueKey is the Redis LIST drained by claude-code-joanne. Each entry is a JSON object
// produced by EnqueueExpiryDMJob.
const JoanneExpiryDMQueueKey = keyPrefix + ":joanne:expiry-dm-queue"

// ExpiryDMJob is the JSON shape pushed onto JoanneExpiryDMQueueKey. Joanne's drain loop unmarshals
// these, opens an IM with SlackUserID, and posts copy keyed by Reason. The trial-expiry reaper
// produces jobs with Reason="" (or absent), which Joanne renders with the v2 expiry copy
// (claude-code-joanne#171 / makeacompany-ai#328). The cancel-webhook path produces jobs with
// Reason="subscription_canceled" (#341), which Joanne renders with the winback copy.
type ExpiryDMJob struct {
	SlackUserID       string `json:"slack_user_id"`
	Email             string `json:"email"`
	StripeCheckoutURL string `json:"stripe_checkout_url"`
	// Reason discriminates job kind for the Joanne drain. Empty = trial-expired (the original
	// reaper path). "subscription_canceled" = winback after cancel webhook. Unknown values render
	// the same as empty so a forward-compat field add never breaks the drain.
	Reason string `json:"reason,omitempty"`
}

// ScanTrialExpiredUnenqueued returns profiles whose trial deadline has passed and which have not yet
// been pushed onto the Joanne queue. Caller filters by EffectiveStatus precedence; this returns rows so
// the reaper can stamp expiry_dm_enqueued_at on the same hash it just read.
func (s *Store) ScanTrialExpiredUnenqueued(ctx context.Context, now time.Time) ([]UserProfileRow, error) {
	if s == nil {
		return nil, fmt.Errorf("nil store")
	}
	var rows []UserProfileRow
	var cursor uint64
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, userProfileKeyGlob, 64).Result()
		if err != nil {
			return nil, err
		}
		for _, redisKey := range keys {
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
			row := userProfileRowFromHash(email, vals)
			if row.ExpiryDMEnqueuedAt != "" {
				continue
			}
			if !strings.EqualFold(row.StripeSubscriptionStatus, "trialing") {
				continue
			}
			if row.TrialExpiresAt <= 0 || row.TrialExpiresAt >= now.Unix() {
				continue
			}
			if row.FreeLifetime {
				continue
			}
			rows = append(rows, row)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].TrialExpiresAt < rows[j].TrialExpiresAt })
	return rows, nil
}

// EnqueueExpiryDMJob pushes one job onto JoanneExpiryDMQueueKey and stamps expiry_dm_enqueued_at on the
// profile hash in one pipelined transaction. Joanne's drain side owns the actual DM.
func (s *Store) EnqueueExpiryDMJob(ctx context.Context, email string, job ExpiryDMJob) error {
	if s == nil {
		return fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	payload, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("marshal expiry job: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pipe := s.rdb.TxPipeline()
	pipe.RPush(ctx, JoanneExpiryDMQueueKey, payload)
	pipe.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"expiry_dm_enqueued_at": now,
		"profile_updated_at":    now,
	})
	_, err = pipe.Exec(ctx)
	return err
}

// JoanneDay7CheckinQueueKey is the Redis LIST drained by claude-code-joanne for the day-7
// checkin DM (#616). Separate from JoanneExpiryDMQueueKey so the two drains can rate-limit,
// retry, and observe independently. Each entry is a JSON object produced by EnqueueDay7CheckinJob.
const JoanneDay7CheckinQueueKey = keyPrefix + ":joanne:day7-checkin-queue"

// Day7CheckinJob is the JSON shape pushed onto JoanneDay7CheckinQueueKey. Joanne's drain loop
// opens an IM with SlackUserID and posts the day-7 checkin copy. Reason is reserved for forward
// compat (e.g. a future "day14" variant on the same queue); the v1 reaper sets it to "day7_signup".
type Day7CheckinJob struct {
	SlackUserID string `json:"slack_user_id"`
	Email       string `json:"email"`
	Reason      string `json:"reason,omitempty"`
}

// Day7CheckinEnqueueWindow is the open-ended slack the day-7 reaper accepts past the 7-day
// boundary before it gives up on a user. Anchored from SignupAt: users whose anchor is
// older than now-(7d+window) are skipped so a freshly-deployed reaper doesn't fire stale
// pings to pre-existing accounts, and so a reaper outage longer than the window forfeits
// any users who would have aged out during the gap rather than burning their first
// impression on a "we were down" DM. 7 days is generous; if the reaper is down longer
// than that, the bigger problem is that the reaper is down.
const Day7CheckinEnqueueWindow = 7 * 24 * time.Hour

// ScanDay7CheckinDue returns profiles whose SignupAt is between (now - 7d - window) and
// (now - 7d), have a Slack ID, and have not yet been pushed onto the day-7 queue. The
// window guards against backfill of ancient users at deploy time and bounds the
// reaper's recovery horizon. Caller is the reaper handler; it stamps
// day7_checkin_enqueued_at on the same hash via EnqueueDay7CheckinJob.
func (s *Store) ScanDay7CheckinDue(ctx context.Context, now time.Time) ([]UserProfileRow, error) {
	if s == nil {
		return nil, fmt.Errorf("nil store")
	}
	dueAt := now.Add(-7 * 24 * time.Hour)
	windowFloor := dueAt.Add(-Day7CheckinEnqueueWindow)
	var rows []UserProfileRow
	var cursor uint64
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, userProfileKeyGlob, 64).Result()
		if err != nil {
			return nil, err
		}
		for _, redisKey := range keys {
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
			row := userProfileRowFromHash(email, vals)
			if row.Day7CheckinEnqueuedAt != "" {
				continue
			}
			if strings.TrimSpace(row.SlackUserID) == "" {
				continue
			}
			signup, err := time.Parse(time.RFC3339, row.SignupAt)
			if err != nil || signup.IsZero() {
				continue
			}
			if signup.After(dueAt) {
				continue
			}
			if signup.Before(windowFloor) {
				continue
			}
			rows = append(rows, row)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].SignupAt < rows[j].SignupAt })
	return rows, nil
}

// EnqueueDay7CheckinJob pushes one job onto JoanneDay7CheckinQueueKey and stamps
// day7_checkin_enqueued_at on the profile hash in one pipelined transaction. Idempotency
// is the caller's job — check Day7CheckinEnqueuedAt (or rely on ScanDay7CheckinDue's
// filter) before calling.
func (s *Store) EnqueueDay7CheckinJob(ctx context.Context, email string, job Day7CheckinJob) error {
	if s == nil {
		return fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if strings.TrimSpace(job.Reason) == "" {
		job.Reason = "day7_signup"
	}
	payload, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("marshal day7 checkin job: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pipe := s.rdb.TxPipeline()
	pipe.RPush(ctx, JoanneDay7CheckinQueueKey, payload)
	pipe.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"day7_checkin_enqueued_at": now,
		"profile_updated_at":       now,
	})
	_, err = pipe.Exec(ctx)
	return err
}

// SetDay7CheckinResponse writes a free-text summary back onto the profile hash. Joanne
// calls this after parsing the user's reply to the day-7 DM. Overwrites any prior
// response (a follow-up reply replaces, not appends).
func (s *Store) SetDay7CheckinResponse(ctx context.Context, email, response string) error {
	if s == nil {
		return fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	return s.rdb.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"day7_checkin_response": strings.TrimSpace(response),
		"profile_updated_at":    now,
	}).Err()
}

// EnqueueWinbackDMJob pushes one cancel-winback job onto JoanneExpiryDMQueueKey (same queue,
// same drain) and stamps winback_dm_enqueued_at on the profile hash. Idempotency is the
// caller's job — check WinbackDMEnqueuedAt before calling. The Joanne drain branches on
// job.Reason to render different copy. See #341.
func (s *Store) EnqueueWinbackDMJob(ctx context.Context, email string, job ExpiryDMJob) error {
	if s == nil {
		return fmt.Errorf("nil store")
	}
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if strings.TrimSpace(job.Reason) == "" {
		job.Reason = "subscription_canceled"
	}
	payload, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("marshal winback job: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	pipe := s.rdb.TxPipeline()
	pipe.RPush(ctx, JoanneExpiryDMQueueKey, payload)
	pipe.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"winback_dm_enqueued_at": now,
		"profile_updated_at":     now,
	})
	_, err = pipe.Exec(ctx)
	return err
}

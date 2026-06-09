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
	return s.rdb.HSet(ctx, userProfileRedisKey(email), fields).Err()
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
	return s.rdb.HSet(ctx, userProfileRedisKey(email), fields).Err()
}

// MarkProfileFreeLifetime stamps free_lifetime=true on the profile hash. Used by the first-100-users backfill
// (see scripts/backfill-free-lifetime.sh) and by any future signup path that decides at write time the user
// falls under the cliff.
func (s *Store) MarkProfileFreeLifetime(ctx context.Context, email string) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	return s.rdb.HSet(ctx, userProfileRedisKey(email), map[string]any{
		"email":              email,
		"free_lifetime":      "true",
		"profile_updated_at": now,
	}).Err()
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
	Email                               string `json:"email"`
	StripeCustomerID                    string `json:"stripeCustomerId"`
	StripeSubscriptionID                string `json:"stripeSubscriptionId"`
	StripeSubscriptionStatus            string `json:"stripeSubscriptionStatus"`
	StripePriceID                       string `json:"stripePriceId"`
	StripeSessionID                     string `json:"stripeSessionId"`
	StripeProductID                     string `json:"stripeProductId"`
	Tier                                string `json:"tier"`
	SlackUserID                         string `json:"slackUserId"`
	WaitlistPaymentStatus               string `json:"waitlistPaymentStatus"`
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
	// TrialExpiresAt is the unix-second deadline for the post-cliff 7-day trial. 0 when not trialing.
	TrialExpiresAt int64 `json:"trialExpiresAt,omitempty"`
	// ExpiryDMEnqueuedAt is the RFC3339 timestamp the trial-expiry reaper pushed the Joanne-side DM job
	// for this user. Non-empty means the reaper has already queued; #244 uses this as the idempotency
	// guard so a slow Joanne drain (or a flapping cron) doesn't fan out duplicate DMs.
	ExpiryDMEnqueuedAt string `json:"expiryDmEnqueuedAt,omitempty"`
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
)

// EffectiveStatus collapses StripeSubscriptionStatus, FreeLifetime, and TrialExpiresAt into one lifecycle
// value. Precedence: Stripe active wins over everything (handles trial→paid). Then free_lifetime (the
// pre-100 cliff). Then a live trial_expires_at gates trialing vs expired. Default is free_lifetime — the
// conservative choice so unknown profiles don't get silenced when #243 lands.
func EffectiveStatus(row UserProfileRow, now time.Time) LifecycleStatus {
	if strings.EqualFold(strings.TrimSpace(row.StripeSubscriptionStatus), "active") {
		return LifecycleActive
	}
	if row.FreeLifetime {
		return LifecycleFreeLifetime
	}
	if row.TrialExpiresAt > 0 {
		if now.Unix() < row.TrialExpiresAt {
			return LifecycleTrialing
		}
		return LifecycleExpired
	}
	if strings.EqualFold(strings.TrimSpace(row.StripeSubscriptionStatus), "trialing") {
		return LifecycleTrialing
	}
	return LifecycleFreeLifetime
}

// DeployGateStatus describes whether a user may ship a deployment.
type DeployGateStatus struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"` // "gate_disabled" | "paid" | "free_tier_available" | "free_tier_consumed"
}

// CheckDeployGate returns whether the user is allowed to ship based on subscription and free-tier state.
// When gateEnabled is false, always allows (the gate can ship to prod before being turned on).
func CheckDeployGate(row UserProfileRow, gateEnabled bool) DeployGateStatus {
	if !gateEnabled {
		return DeployGateStatus{Allowed: true, Reason: "gate_disabled"}
	}
	switch strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus)) {
	case "active", "trialing":
		return DeployGateStatus{Allowed: true, Reason: "paid"}
	}
	if !row.FreeTierConsumed {
		return DeployGateStatus{Allowed: true, Reason: "free_tier_available"}
	}
	return DeployGateStatus{Allowed: false, Reason: "free_tier_consumed"}
}

// EnrichSlackWorkspaceUsersWithProfileTerms merges profile fields from makeacompany:user_profile into each row
// (via makeacompany:user_by_slack): humans terms, resolved lifecycle status, trial expiry, and Stripe customer id.
// Uses two pipelined batches (slack→email lookup, then profile HMGET) so it stays O(2) round-trips regardless of
// member count — see admin trial-gating (#245).
func (s *Store) EnrichSlackWorkspaceUsersWithProfileTerms(ctx context.Context, users []SlackWorkspaceUser) {
	if s == nil || len(users) == 0 {
		return
	}
	idxs := make([]int, 0, len(users))
	for i := range users {
		if users[i].IsBot || users[i].IsDeleted {
			continue
		}
		if strings.TrimSpace(users[i].SlackUserID) == "" {
			continue
		}
		idxs = append(idxs, i)
	}
	if len(idxs) == 0 {
		return
	}

	// Batch 1: slack_user_id -> normalized email.
	emailCmds := make([]*redis.StringCmd, len(idxs))
	pipe := s.rdb.Pipeline()
	for k, i := range idxs {
		emailCmds[k] = pipe.Get(ctx, userBySlackRedisKey(strings.TrimSpace(users[i].SlackUserID)))
	}
	_, _ = pipe.Exec(ctx) // per-cmd errors checked below; redis.Nil is expected for unlinked users

	type pending struct {
		userIdx int
		hmGet   *redis.SliceCmd
	}
	pendings := make([]pending, 0, len(idxs))
	pipe2 := s.rdb.Pipeline()
	profileFields := []string{
		"humans_terms_accepted_at",
		"humans_terms_accepted_slack_message_ts",
		"stripe_subscription_status",
		"stripe_subscription_current_period_end",
		"trial_expires_at",
		"stripe_customer_id",
		"free_lifetime",
	}
	for k, i := range idxs {
		raw, err := emailCmds[k].Result()
		if err != nil {
			continue
		}
		em := normalizeProfileEmail(raw)
		if em == "" {
			continue
		}
		pendings = append(pendings, pending{
			userIdx: i,
			hmGet:   pipe2.HMGet(ctx, userProfileRedisKey(em), profileFields...),
		})
	}
	if len(pendings) == 0 {
		return
	}
	_, _ = pipe2.Exec(ctx)

	now := time.Now()
	for _, p := range pendings {
		vals, err := p.hmGet.Result()
		if err != nil || len(vals) < len(profileFields) {
			continue
		}
		strAt := func(idx int) string {
			if vals[idx] == nil {
				return ""
			}
			v, ok := vals[idx].(string)
			if !ok {
				return ""
			}
			return strings.TrimSpace(v)
		}
		users[p.userIdx].Terms = strAt(0)
		users[p.userIdx].TermsMessageTs = strAt(1)
		row := UserProfileRow{
			StripeSubscriptionStatus:           strAt(2),
			StripeSubscriptionCurrentPeriodEnd: parseUnixSecondsString(strAt(3)),
			TrialExpiresAt:                     parseUnixSecondsString(strAt(4)),
			StripeCustomerID:                   strAt(5),
			FreeLifetime:                       strings.EqualFold(strAt(6), "true"),
		}
		status := EffectiveStatus(row, now)
		users[p.userIdx].Status = string(status)
		users[p.userIdx].StripeCustomerID = row.StripeCustomerID
		if status == LifecycleTrialing && row.TrialExpiresAt > 0 {
			users[p.userIdx].TrialExpiresAt = row.TrialExpiresAt
		}
	}
}

// JoanneExpiryDMQueueKey is the Redis LIST drained by claude-code-joanne. Each entry is a JSON object
// produced by EnqueueExpiryDMJob.
const JoanneExpiryDMQueueKey = keyPrefix + ":joanne:expiry-dm-queue"

// ExpiryDMJob is the JSON shape pushed onto JoanneExpiryDMQueueKey for each trial-expired user.
// Joanne's drain loop unmarshals these, opens an IM with SlackUserID, and posts the v1 copy
// (#248) substituting StripeCheckoutURL for the <stripe-link> placeholder.
type ExpiryDMJob struct {
	SlackUserID       string `json:"slack_user_id"`
	Email             string `json:"email"`
	StripeCheckoutURL string `json:"stripe_checkout_url"`
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

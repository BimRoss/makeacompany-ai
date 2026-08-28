package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Credit metering (#797). Balance and audit counters live as fields on the
// existing makeacompany:user_profile:<email> hash, alongside the Stripe/BYOK
// fields, so there is no second store to scan or keep in sync. One credit is
// spent per real-work spawn; the harness admission-checks before doing work and
// decrements at its reply gate once real work is confirmed.
const (
	creditsBalanceField       = "credits_balance"
	creditsGrantedTotalField  = "credits_granted_total"
	creditsConsumedTotalField = "credits_consumed_total"
	creditsLastGrantAtField   = "credits_last_grant_at"
	creditsSeededAtField      = "credits_seeded_at"
	creditsUnlimitedField     = "credits_unlimited"
	// slackTeamIDField records the Slack team a user first showed up from, for
	// analytics only. Billing identity stays one-per-user (email), per #797 decision 2.
	slackTeamIDField = "slack_team_id"
)

// parseInt64String reads a base-10 int64 from a Redis field, returning 0 on
// empty or malformed input (an unseeded credit field reads as 0).
func parseInt64String(v string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	return n
}

// creditConsumeIdemKey namespaces the SET-NX idempotency marker a consume can
// carry so a retried real-work spawn (same key) does not double-charge.
func creditConsumeIdemKey(idempotencyKey string) string {
	return fmt.Sprintf("%s:credit_consume:%s", keyPrefix, strings.TrimSpace(idempotencyKey))
}

// creditIdemTTL bounds how long a consume idempotency marker lives. A spawn's
// retries all land inside this window; after it, the key is reclaimed.
const creditIdemTTL = 24 * time.Hour

// CreditBalance is the credit view for one user.
type CreditBalance struct {
	// Balance is the remaining spendable credits. Meaningless when Unlimited is true.
	Balance int64 `json:"balance"`
	// Unlimited is the admin-set comp flag (credits_unlimited=true): the user is
	// never metered or blocked. Off by default for everyone at launch (#797 decision 3).
	Unlimited bool `json:"unlimited"`
	// Seeded is false only when the profile had no credit fields before this call
	// forced the initial grant. Callers can use it to tell "brand new" from "spent down".
	Seeded bool `json:"seeded"`
}

// seedCreditsLua grants the initial balance exactly once. HSETNX makes it a
// no-op on an already-seeded profile, so it is safe to call on every read.
//
//	KEYS[1] = profile hash
//	ARGV[1] = initial grant (int, as string)
//	ARGV[2] = now (RFC3339)
//
// Returns 1 when it seeded, 0 when the balance already existed.
const seedCreditsLua = `
if redis.call("HSETNX", KEYS[1], "credits_balance", ARGV[1]) == 1 then
  redis.call("HINCRBY", KEYS[1], "credits_granted_total", tonumber(ARGV[1]))
  redis.call("HSET", KEYS[1], "credits_last_grant_at", ARGV[2], "credits_seeded_at", ARGV[2], "profile_updated_at", ARGV[2])
  return 1
end
return 0
`

// consumeCreditsLua atomically spends n credits. Order matters: unlimited comps
// and insufficient balance short-circuit before the idempotency marker is set,
// so a blocked spawn never burns its idempotency key.
//
//	KEYS[1] = profile hash
//	KEYS[2] = idempotency marker key ("" to skip the dedupe)
//	ARGV[1] = n (int, as string)
//	ARGV[2] = now (RFC3339)
//	ARGV[3] = idempotency TTL seconds (as string)
//
// Returns {status, balance}:
//
//	{2, -1}  unlimited comp — nothing charged
//	{0, bal} insufficient — nothing charged, bal unchanged
//	{3, bal} duplicate idempotency key — nothing charged
//	{1, bal} charged — bal is the post-decrement balance
const consumeCreditsLua = `
if redis.call("HGET", KEYS[1], "credits_unlimited") == "true" then
  return {2, -1}
end
local n = tonumber(ARGV[1])
local bal = tonumber(redis.call("HGET", KEYS[1], "credits_balance")) or 0
if bal < n then
  return {0, bal}
end
if KEYS[2] ~= "" then
  if not redis.call("SET", KEYS[2], ARGV[2], "NX", "EX", ARGV[3]) then
    return {3, bal}
  end
end
bal = redis.call("HINCRBY", KEYS[1], "credits_balance", -n)
redis.call("HINCRBY", KEYS[1], "credits_consumed_total", n)
redis.call("HSET", KEYS[1], "profile_updated_at", ARGV[2])
return {1, bal}
`

// SeedCreditsIfUnset grants the initial credit allotment to a profile that has
// never been seeded. Idempotent: an already-seeded balance is left untouched.
// Returns true when it performed the seed. amount <= 0 falls back to 0 (a valid
// empty grant) rather than erroring, so a misconfigured env can't hand out negatives.
func (s *Store) SeedCreditsIfUnset(ctx context.Context, email string, amount int) (bool, error) {
	email = normalizeProfileEmail(email)
	if email == "" {
		return false, fmt.Errorf("missing email")
	}
	if amount < 0 {
		amount = 0
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.rdb.Eval(ctx, seedCreditsLua, []string{userProfileRedisKey(email)},
		strconv.Itoa(amount), now).Int64()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

// GetCredits returns the credit view for a user, seeding the initial grant on
// first sight so a profile that predates the backfill self-heals instead of
// reading as a paywalled zero. Pass the initial grant (cfg.CreditInitialGrant).
func (s *Store) GetCredits(ctx context.Context, email string, initialGrant int) (CreditBalance, error) {
	email = normalizeProfileEmail(email)
	if email == "" {
		return CreditBalance{}, fmt.Errorf("missing email")
	}
	seeded, err := s.SeedCreditsIfUnset(ctx, email, initialGrant)
	if err != nil {
		return CreditBalance{}, err
	}
	vals, err := s.rdb.HMGet(ctx, userProfileRedisKey(email), creditsBalanceField, creditsUnlimitedField).Result()
	if err != nil {
		return CreditBalance{}, err
	}
	out := CreditBalance{Seeded: !seeded}
	if len(vals) == 2 {
		if bs, ok := vals[0].(string); ok {
			out.Balance, _ = strconv.ParseInt(strings.TrimSpace(bs), 10, 64)
		}
		if us, ok := vals[1].(string); ok {
			out.Unlimited = strings.EqualFold(strings.TrimSpace(us), "true")
		}
	}
	return out, nil
}

// Consume outcomes, one per terminal branch of consumeCreditsLua.
const (
	ConsumeCharged      = "charged"
	ConsumeInsufficient = "insufficient"
	ConsumeDuplicate    = "duplicate"
	ConsumeUnlimited    = "unlimited"
)

// ConsumeCredits spends n credits atomically and reports the outcome.
// idempotencyKey may be empty to skip dedupe; when set, a repeat call with the
// same key inside creditIdemTTL is a no-op reporting ConsumeDuplicate. It seeds
// the initial grant first so a consume can never fail merely because the profile
// predates the backfill. balance carries the post-call balance (meaningless for
// ConsumeUnlimited).
func (s *Store) ConsumeCredits(ctx context.Context, email string, n int, idempotencyKey string, initialGrant int) (outcome string, balance int64, err error) {
	email = normalizeProfileEmail(email)
	if email == "" {
		return "", 0, fmt.Errorf("missing email")
	}
	if n <= 0 {
		n = 1
	}
	if _, err := s.SeedCreditsIfUnset(ctx, email, initialGrant); err != nil {
		return "", 0, err
	}
	idemKey := ""
	if strings.TrimSpace(idempotencyKey) != "" {
		idemKey = creditConsumeIdemKey(idempotencyKey)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	raw, err := s.rdb.Eval(ctx, consumeCreditsLua,
		[]string{userProfileRedisKey(email), idemKey},
		strconv.Itoa(n), now, strconv.Itoa(int(creditIdemTTL/time.Second)),
	).Slice()
	if err != nil {
		return "", 0, err
	}
	status, bal := creditEvalPair(raw)
	switch status {
	case 2:
		return ConsumeUnlimited, -1, nil
	case 1:
		return ConsumeCharged, bal, nil
	case 3:
		return ConsumeDuplicate, bal, nil
	default:
		return ConsumeInsufficient, bal, nil
	}
}

// creditEvalPair reads the {status, balance} array a consume Lua returns.
// go-redis surfaces Lua integers as int64; anything unexpected reads as 0.
func creditEvalPair(raw []interface{}) (status, balance int64) {
	if len(raw) > 0 {
		status, _ = raw[0].(int64)
	}
	if len(raw) > 1 {
		balance, _ = raw[1].(int64)
	}
	return status, balance
}

// GrantCredits adds n credits (Stripe top-up, recurring refill, or an admin
// grant) and stamps the grant time. n must be positive.
func (s *Store) GrantCredits(ctx context.Context, email string, n int) (int64, error) {
	email = normalizeProfileEmail(email)
	if email == "" {
		return 0, fmt.Errorf("missing email")
	}
	if n <= 0 {
		return 0, fmt.Errorf("grant must be positive")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := userProfileRedisKey(email)
	pipe := s.rdb.TxPipeline()
	bal := pipe.HIncrBy(ctx, key, creditsBalanceField, int64(n))
	pipe.HIncrBy(ctx, key, creditsGrantedTotalField, int64(n))
	pipe.HSet(ctx, key, map[string]any{
		creditsLastGrantAtField: now,
		"profile_updated_at":    now,
	})
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return bal.Val(), nil
}

// SetCreditsUnlimited toggles the comp flag. "false" is written rather than
// deleted so the state is unambiguous and auditable, matching SetProfileFreeLifetime.
func (s *Store) SetCreditsUnlimited(ctx context.Context, email string, unlimited bool) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	return s.MergeUserProfileFields(ctx, email, map[string]any{
		creditsUnlimitedField: strconv.FormatBool(unlimited),
	})
}

// SetSlackTeamID records the originating Slack team on the profile (analytics
// only, per #797 decision 2). Written once via HSETNX so a later spawn from a
// different team can't rewrite provenance.
func (s *Store) SetSlackTeamID(ctx context.Context, email, teamID string) error {
	email = normalizeProfileEmail(email)
	teamID = strings.TrimSpace(teamID)
	if email == "" || teamID == "" {
		return nil
	}
	return s.rdb.HSetNX(ctx, userProfileRedisKey(email), slackTeamIDField, teamID).Err()
}

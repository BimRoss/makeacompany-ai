#!/usr/bin/env bash
# Seed credits_balance on every user_profile hash that lacks it (#797), so existing users get their
# 100-credit grant without waiting for their next spawn to self-heal. Idempotent — HSETNX-style guard,
# safe to re-run. Only seeds profiles with no credits_balance field; already-seeded balances are untouched.
#
# Note: the backend also seeds on first read (GetCredits/ConsumeCredits call SeedCreditsIfUnset), so this
# script is a pre-warm for visibility/analytics, not a correctness requirement. Run it once after deploy
# so the admin table shows balances for users who haven't spawned yet.
#
# Usage:
#   REDIS_URL=redis://... ./scripts/backfill-credits.sh            # dry-run
#   REDIS_URL=redis://... ./scripts/backfill-credits.sh --apply    # write
#   GRANT=100 REDIS_URL=... ./scripts/backfill-credits.sh --apply  # custom grant (default 100)

set -euo pipefail

: "${REDIS_URL:?REDIS_URL is required}"
GRANT="${GRANT:-100}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

KEY_PREFIX="makeacompany:user_profile:"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mapfile -t keys < <(redis-cli -u "$REDIS_URL" --no-raw KEYS "${KEY_PREFIX}*" | tr -d '"')

seeded=0
skipped=0
for k in "${keys[@]}"; do
  email=$(redis-cli -u "$REDIS_URL" HGET "$k" email)
  existing=$(redis-cli -u "$REDIS_URL" HGET "$k" credits_balance)
  if [[ -n "$existing" ]]; then
    printf '[skip already seeded: %s] %s\n' "$existing" "$email"
    skipped=$((skipped+1))
    continue
  fi
  if (( APPLY )); then
    # HSETNX guards against a race with the backend's own seed-on-read; if the backend won, we no-op.
    if [[ "$(redis-cli -u "$REDIS_URL" HSETNX "$k" credits_balance "$GRANT")" == "1" ]]; then
      redis-cli -u "$REDIS_URL" HSET "$k" \
        credits_granted_total "$GRANT" \
        credits_last_grant_at "$now" \
        credits_seeded_at "$now" \
        profile_updated_at "$now" >/dev/null
      printf '[applied grant=%s] %s\n' "$GRANT" "$email"
      seeded=$((seeded+1))
    else
      printf '[skip raced backend seed] %s\n' "$email"
      skipped=$((skipped+1))
    fi
  else
    printf '[dry-run] would seed credits_balance=%s on %s\n' "$GRANT" "$email"
    seeded=$((seeded+1))
  fi
done

printf '\nSeeded %d, skipped %d (grant=%s, apply=%d).\n' "$seeded" "$skipped" "$GRANT" "$APPLY"

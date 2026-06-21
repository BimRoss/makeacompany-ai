#!/usr/bin/env bash
# Backfill signup_at on existing user_profile hashes so TTFV (#579) can compute
# against historical rows. Idempotent: HSETNX so a row that already has signup_at
# is left untouched.
#
# Derivation:
#   trial_expires_at > 0  -> signup_at = trial_expires_at - 10 days (FreeTrialDuration)
#   else                  -> signup_at = profile_updated_at
#   (no signup_at written if neither is present)
#
# Usage:
#   REDIS_URL=redis://... ./scripts/backfill-signup-at.sh           # dry-run
#   REDIS_URL=redis://... ./scripts/backfill-signup-at.sh --apply   # write

set -euo pipefail

: "${REDIS_URL:?REDIS_URL is required}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

KEY_PREFIX="makeacompany:user_profile:"
TRIAL_SECONDS=$((10 * 24 * 3600))

mapfile -t keys < <(redis-cli -u "$REDIS_URL" --no-raw KEYS "${KEY_PREFIX}*" | tr -d '"')

written=0
skipped_existing=0
skipped_no_anchor=0
for k in "${keys[@]}"; do
  existing=$(redis-cli -u "$REDIS_URL" HGET "$k" signup_at)
  if [[ -n "$existing" ]]; then
    skipped_existing=$((skipped_existing+1))
    continue
  fi

  trial_expires=$(redis-cli -u "$REDIS_URL" HGET "$k" trial_expires_at)
  profile_updated=$(redis-cli -u "$REDIS_URL" HGET "$k" profile_updated_at)

  signup_at=""
  if [[ -n "$trial_expires" && "$trial_expires" -gt 0 ]] 2>/dev/null; then
    signup_unix=$((trial_expires - TRIAL_SECONDS))
    signup_at=$(date -u -d "@${signup_unix}" +%Y-%m-%dT%H:%M:%SZ)
  elif [[ -n "$profile_updated" ]]; then
    signup_at="$profile_updated"
  fi

  if [[ -z "$signup_at" ]]; then
    skipped_no_anchor=$((skipped_no_anchor+1))
    continue
  fi

  email=$(redis-cli -u "$REDIS_URL" HGET "$k" email)
  if (( APPLY )); then
    redis-cli -u "$REDIS_URL" HSETNX "$k" signup_at "$signup_at" >/dev/null
    printf '[applied] %s -> %s\n' "$email" "$signup_at"
  else
    printf '[dry-run] %s -> %s\n' "$email" "$signup_at"
  fi
  written=$((written+1))
done

printf '\nWrote=%d already-set=%d no-anchor=%d apply=%d.\n' \
  "$written" "$skipped_existing" "$skipped_no_anchor" "$APPLY"

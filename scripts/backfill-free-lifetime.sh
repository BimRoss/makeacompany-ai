#!/usr/bin/env bash
# Backfill free_lifetime=true on the first N user_profile hashes (default: 100) so the post-100
# trial gate (umbrella #240) never silences pre-cliff users. Idempotent — safe to re-run.
#
# Usage:
#   REDIS_URL=redis://... ./scripts/backfill-free-lifetime.sh           # dry-run, top 100
#   REDIS_URL=redis://... ./scripts/backfill-free-lifetime.sh --apply   # write
#   N=150 REDIS_URL=... ./scripts/backfill-free-lifetime.sh --apply     # custom cap
#
# Ordering: sorts profile hashes by profile_updated_at ascending (oldest first). Profiles missing
# the timestamp sort last (the cliff is about who signed up earliest; missing-ts is safer to exclude).

set -euo pipefail

: "${REDIS_URL:?REDIS_URL is required}"
N="${N:-100}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

KEY_PREFIX="makeacompany:user_profile:"

mapfile -t keys < <(redis-cli -u "$REDIS_URL" --no-raw KEYS "${KEY_PREFIX}*" | tr -d '"')

declare -A ts_by_key
for k in "${keys[@]}"; do
  ts=$(redis-cli -u "$REDIS_URL" HGET "$k" profile_updated_at)
  ts_by_key[$k]="${ts:-9999-99-99}"
done

readarray -t sorted < <(for k in "${!ts_by_key[@]}"; do printf '%s\t%s\n' "${ts_by_key[$k]}" "$k"; done | sort | cut -f2-)

count=0
for k in "${sorted[@]}"; do
  if (( count >= N )); then break ; fi
  email=$(redis-cli -u "$REDIS_URL" HGET "$k" email)
  existing=$(redis-cli -u "$REDIS_URL" HGET "$k" free_lifetime)
  if [[ "$existing" == "true" ]]; then
    printf '[skip already free_lifetime] %s\n' "$email"
    count=$((count+1))
    continue
  fi
  if (( APPLY )); then
    redis-cli -u "$REDIS_URL" HSET "$k" free_lifetime "true" profile_updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
    printf '[applied] %s\n' "$email"
  else
    printf '[dry-run] would set free_lifetime=true on %s\n' "$email"
  fi
  count=$((count+1))
done

printf '\nProcessed %d profiles (cap=%d, apply=%d).\n' "$count" "$N" "$APPLY"

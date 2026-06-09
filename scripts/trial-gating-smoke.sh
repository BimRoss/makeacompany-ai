#!/usr/bin/env bash
# End-to-end smoke for the post-100 trial-gating flow (issue #327).
#
# We have no staging cluster — backend, Redis, and the bot pods are all
# the same one prod uses. So this smoke is careful: it operates on a
# synthetic profile (TEST_EMAIL / TEST_SLACK_ID below) that no real human
# owns, never sends a real Slack DM (the fake Slack ID will 404 inside
# Joanne's drain loop), and cleans up after itself.
#
# Usage:
#   ./scripts/trial-gating-smoke.sh                 # run full smoke + cleanup
#   ./scripts/trial-gating-smoke.sh --keep          # skip cleanup so you can poke
#   ./scripts/trial-gating-smoke.sh --cleanup-only  # only delete prior smoke state
#
# Requires:
#   - kubectl context on the admin cluster (KUBECONFIG=~/.kube/config/admin.yaml)
#   - Read access to the makeacompany-ai-backend pod (BACKEND_INTERNAL_SERVICE_TOKEN)
#   - Read/write access to the makeacompany-ai-redis pod (default svc account)
#
# Covers steps from issue #327 that are exercisable without a real Slack message
# loop: profile creation, /v1/internal/user-status resolution, reaper enqueue,
# idempotency, allowlist bypass, Stripe-active unsilence, queue cleanup. Steps
# that need a real human in a Slack channel (1, 5 verbatim) are stubbed with
# expected outputs the operator should manually verify after the smoke passes.

set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────────
NS_BACKEND="makeacompany-ai"
NS_BOT_JOANNE_PROD="claude-code-joanne-prod"
NS_BOT_ROSS_PROD="claude-code-ross-prod"
DEPLOY_BACKEND="makeacompany-ai-backend"
DEPLOY_REDIS="makeacompany-ai-redis"
KEY_PREFIX="makeacompany"

STAMP="$(date -u +%Y%m%d%H%M%S)"
TEST_EMAIL="smoke-trial-gating-${STAMP}@test.local"
# U0SMOKE… is reserved-by-convention: no real Slack user ID starts with this
# prefix, so Joanne's drain loop will 404 when it tries to DM the address.
TEST_SLACK_ID="U0SMOKE${STAMP:0:9}"
PROFILE_KEY="${KEY_PREFIX}:user_profile:${TEST_EMAIL}"
SLACK_INDEX_KEY="${KEY_PREFIX}:user_by_slack:${TEST_SLACK_ID}"
QUEUE_KEY="${KEY_PREFIX}:joanne:expiry-dm-queue"
DLQ_KEY="${KEY_PREFIX}:joanne:expiry-dm-dlq"
DRAIN_INTERVAL_SECONDS=30
DRAIN_TIMEOUT_SECONDS=90

CLEANUP=1
CLEANUP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --keep)         CLEANUP=0 ;;
    --cleanup-only) CLEANUP_ONLY=1 ;;
    -h|--help)      grep -E '^# ' "$0" | sed 's/^# \?//' ; exit 0 ;;
  esac
done

# ── helpers ───────────────────────────────────────────────────────────────────
red()    { printf '\033[31m%s\033[0m\n' "$*" ; }
green()  { printf '\033[32m%s\033[0m\n' "$*" ; }
yellow() { printf '\033[33m%s\033[0m\n' "$*" ; }
bold()   { printf '\033[1m%s\033[0m\n' "$*" ; }

step()   { echo ; bold "── $* ──" ; }
pass()   { green "  ✓ $*" ; }
fail()   { red   "  ✗ $*" ; FAILED=1 ; }
info()   { echo  "  · $*" ; }

redis()  { kubectl exec -n "$NS_BACKEND" "deploy/$DEPLOY_REDIS" -- redis-cli --no-auth-warning "$@" 2>/dev/null ; }

backend_token() {
  kubectl exec -n "$NS_BACKEND" "deploy/$DEPLOY_BACKEND" -- sh -c 'printf "%s" "$BACKEND_INTERNAL_SERVICE_TOKEN"'
}

backend_curl() {
  # backend_curl <method> <path-with-query>
  # Runs curl from inside a bot pod (it has curl + the right token). Returns "HTTP <code>\n<body>".
  local method="$1" path="$2"
  kubectl exec -n "$NS_BOT_JOANNE_PROD" "deploy/claude-code-joanne" -c claude-code-joanne -- sh -c "
    curl -sS -X $method \
      -H \"Authorization: Bearer \${MAC_INTERNAL_SERVICE_TOKEN}\" \
      -w '\nHTTP %{http_code}\n' \
      \"\${MAC_BACKEND_URL}$path\"
  " 2>&1 | grep -vE '^Defaulted'
}

status_for_slack() {
  backend_curl GET "/v1/internal/user-status?slack_user_id=$1" \
    | awk '/^HTTP /{code=$2} /"status"/{ match($0,/"status":"[^"]*"/); s=substr($0,RSTART+10,RLENGTH-11) } END { printf "%s|%s", code, s }'
}

reaper_post() {
  kubectl exec -n "$NS_BACKEND" "deploy/$DEPLOY_BACKEND" -- sh -c "
    # backend pod has wget but not curl; use wget instead.
    wget -qO- --header=\"Authorization: Bearer \$BACKEND_INTERNAL_SERVICE_TOKEN\" \
      --post-data='' \
      http://localhost:8080/v1/internal/trial-expiry-reaper
  " 2>&1
}

# ── cleanup ───────────────────────────────────────────────────────────────────
do_cleanup() {
  step "cleanup"
  local removed_keys=0 removed_queue=0
  # Sweep any leftover smoke profiles + slack-index entries by pattern.
  local profiles slack_idx
  profiles=$(redis --scan --pattern "${KEY_PREFIX}:user_profile:smoke-trial-gating-*@test.local" || true)
  slack_idx=$(redis --scan --pattern "${KEY_PREFIX}:user_by_slack:U0SMOKE*" || true)
  for k in $profiles $slack_idx ; do
    [ -z "$k" ] && continue
    redis DEL "$k" >/dev/null
    removed_keys=$((removed_keys+1))
  done
  # Drain any smoke jobs off the joanne expiry-dm queue AND DLQ. ExpiryDMJob
  # entries are JSON; pull anything matching the smoke slack-id pattern.
  for list in "$QUEUE_KEY" "$DLQ_KEY"; do
    local qlen i=0
    qlen=$(redis LLEN "$list" || echo 0)
    [ "${qlen:-0}" -eq 0 ] && continue
    while [ "$i" -lt "$qlen" ]; do
      local v
      v=$(redis LINDEX "$list" "$i" || true)
      if echo "$v" | grep -q 'U0SMOKE'; then
        redis LREM "$list" 0 "$v" >/dev/null
        removed_queue=$((removed_queue+1))
      else
        i=$((i+1))
      fi
    done
  done
  info "deleted $removed_keys leftover key(s); pulled $removed_queue smoke job(s) off the joanne queue/DLQ"
}

if [ "$CLEANUP_ONLY" -eq 1 ]; then
  do_cleanup
  exit 0
fi

# Trap so we cleanup even on early-exit (unless --keep).
on_exit() {
  local rc=$?
  if [ "$CLEANUP" -eq 1 ] ; then
    do_cleanup
  else
    yellow "  --keep: leaving profile $PROFILE_KEY in place. Run with --cleanup-only to remove."
  fi
  exit "$rc"
}
trap on_exit EXIT

FAILED=0

bold "== Trial-gating end-to-end smoke =="
echo "  TEST_EMAIL    = $TEST_EMAIL"
echo "  TEST_SLACK_ID = $TEST_SLACK_ID"
echo "  PROFILE_KEY   = $PROFILE_KEY"

# ── prelim: backend reachable + token live (proves #338 fix) ────────────────
step "Prelim: bot can reach /v1/internal/user-status (post-#338)"
info "Hitting the endpoint with the bot's MAC_INTERNAL_SERVICE_TOKEN…"
PRELIM=$(status_for_slack "$TEST_SLACK_ID")
PRELIM_CODE="${PRELIM%%|*}"
if [ "$PRELIM_CODE" = "200" ]; then
  pass "user-status returned 200 (gate is functional)"
else
  fail "user-status returned $PRELIM_CODE — #338 not fully fixed?"
  exit 1
fi

# ── step 0: create the test profile in trialing state, 1 day left ────────────
step "Step 0: create test profile in 'trialing' state (trial_expires_at = now + 86400)"
NOW=$(date -u +%s)
FUTURE=$((NOW + 86400))
redis HSET "$PROFILE_KEY" \
  email "$TEST_EMAIL" \
  slack_user_id "$TEST_SLACK_ID" \
  stripe_subscription_status "trialing" \
  trial_expires_at "$FUTURE" \
  profile_updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
redis SET "$SLACK_INDEX_KEY" "$TEST_EMAIL" >/dev/null
pass "profile created"

# ── step 1: gate resolves to 'trialing' → dispatcher allows messages ─────────
step "Step 1: gate resolves 'trialing' for the live user-status endpoint"
INFO=$(status_for_slack "$TEST_SLACK_ID")
CODE="${INFO%%|*}" STATUS="${INFO##*|}"
if [ "$CODE" = "200" ] && [ "$STATUS" = "trialing" ] ; then
  pass "user-status returned $STATUS"
  info "MANUAL VERIFY: a Ross-mention + Joanne-mention from a trialing user should reply normally."
else
  fail "expected (200, trialing), got ($CODE, $STATUS)"
fi

# ── step 2: fast-forward to expired, fire reaper, expect enqueue ─────────────
step "Step 2: fast-forward to expired and fire reaper"
PAST=$((NOW - 60))
redis HSET "$PROFILE_KEY" trial_expires_at "$PAST" stripe_subscription_status "trialing" >/dev/null
# nuke any stale expiry_dm_enqueued_at if a prior run set it
redis HDEL "$PROFILE_KEY" expiry_dm_enqueued_at >/dev/null
info "trial_expires_at set to now-60s; calling /v1/internal/trial-expiry-reaper…"
RESP1=$(reaper_post)
echo "    response: $RESP1"
SCANNED=$(echo "$RESP1" | grep -oE '"scanned":[0-9]+' | grep -oE '[0-9]+' || echo "?")
ENQUEUED=$(echo "$RESP1" | grep -oE '"enqueued":[0-9]+' | grep -oE '[0-9]+' || echo "?")
if [ "${SCANNED:-0}" -ge 1 ] && [ "${ENQUEUED:-0}" -ge 1 ] ; then
  pass "reaper scanned $SCANNED, enqueued $ENQUEUED"
else
  fail "expected scanned>=1, enqueued>=1; got scanned=$SCANNED enqueued=$ENQUEUED"
fi
STAMP_LIVE=$(redis HGET "$PROFILE_KEY" expiry_dm_enqueued_at || echo "")
if [ -n "$STAMP_LIVE" ] ; then
  pass "expiry_dm_enqueued_at stamped: $STAMP_LIVE"
else
  fail "expiry_dm_enqueued_at not stamped on profile"
fi

# ── step 3: queue has the job, copy looks right ─────────────────────────────
step "Step 3: ExpiryDMJob landed on joanne expiry-dm queue with correct checkout URL"
JOB=$(redis LRANGE "$QUEUE_KEY" -10 -1 | grep "$TEST_SLACK_ID" || true)
if [ -n "$JOB" ] ; then
  pass "found job for $TEST_SLACK_ID on the queue"
  echo "    job: $JOB"
  if echo "$JOB" | grep -q 'buy.stripe.com'; then
    pass "checkout url is a real Stripe Payment Link (not the lander fallback)"
  else
    fail "checkout url isn't a buy.stripe.com link — TRIAL_EXPIRY_CHECKOUT_URL unset?"
  fi
  if echo "$JOB" | grep -q "client_reference_id=$TEST_SLACK_ID"; then
    pass "client_reference_id=$TEST_SLACK_ID present"
  else
    fail "client_reference_id not appended"
  fi
  info "MANUAL VERIFY: Joanne's worker should attempt to DM $TEST_SLACK_ID and log a 404 (fake user) within ~30s."
else
  fail "no job for $TEST_SLACK_ID found on the queue"
fi

# ── step 3.5: wait for Joanne's drain to consume the job and DLQ it ─────────
step "Step 3.5: Joanne's drain consumes the job (fake Slack ID -> DLQ)"
info "drain loop polls every ${DRAIN_INTERVAL_SECONDS}s; waiting up to ${DRAIN_TIMEOUT_SECONDS}s…"
DEADLINE=$(( $(date +%s) + DRAIN_TIMEOUT_SECONDS ))
DRAIN_OK=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  QLEN=$(redis LLEN "$QUEUE_KEY" || echo 0)
  DLQ_HIT=$(redis LRANGE "$DLQ_KEY" -50 -1 | grep -c "$TEST_SLACK_ID" || true)
  if [ "${QLEN:-0}" -eq 0 ] && [ "${DLQ_HIT:-0}" -ge 1 ]; then
    DRAIN_OK=1
    break
  fi
  sleep 5
done
if [ "$DRAIN_OK" -eq 1 ]; then
  pass "drain pulled smoke job off the queue and pushed to DLQ after Slack rejected the fake user"
  info "(this means: real expired user would get a real DM here; fake user safely went to DLQ for inspection)"
else
  QLEN=$(redis LLEN "$QUEUE_KEY" || echo 0)
  DLQ_HIT=$(redis LRANGE "$DLQ_KEY" -50 -1 | grep -c "$TEST_SLACK_ID" || true)
  fail "drain did not complete within ${DRAIN_TIMEOUT_SECONDS}s (queue len=$QLEN, smoke-in-dlq=$DLQ_HIT)"
fi

# ── step 4: idempotency — re-fire the reaper ────────────────────────────────
step "Step 4: idempotency — re-firing the reaper should not re-enqueue"
RESP2=$(reaper_post)
ENQ2=$(echo "$RESP2" | grep -oE '"enqueued":[0-9]+' | grep -oE '[0-9]+' || echo "?")
if [ "${ENQ2:-1}" -eq 0 ] ; then
  pass "second run enqueued=0 (expiry_dm_enqueued_at blocks re-fire)"
else
  fail "second run re-enqueued ($ENQ2) — idempotency broken"
fi

# ── step 5: gate resolves to 'expired' → dispatcher would silence ────────────
step "Step 5: gate now resolves 'expired'"
INFO=$(status_for_slack "$TEST_SLACK_ID")
CODE="${INFO%%|*}" STATUS="${INFO##*|}"
if [ "$CODE" = "200" ] && [ "$STATUS" = "expired" ] ; then
  pass "user-status returned $STATUS"
  info "MANUAL VERIFY: a Ross-mention + Joanne-mention from this user would now produce ZERO stdout from both dispatchers (silent drop)."
else
  fail "expected (200, expired), got ($CODE, $STATUS)"
fi

# ── step 6: simulate paid — stripe_subscription_status=active → unsilence ───
step "Step 6: simulate paid (mark profile active, gate flips back)"
redis HSET "$PROFILE_KEY" stripe_subscription_status "active" >/dev/null
redis HDEL "$PROFILE_KEY" trial_expires_at >/dev/null
INFO=$(status_for_slack "$TEST_SLACK_ID")
CODE="${INFO%%|*}" STATUS="${INFO##*|}"
if [ "$CODE" = "200" ] && [ "$STATUS" = "active" ] ; then
  pass "user-status returned $STATUS (Stripe-active wins over everything)"
  info "Skipping the real Stripe checkout.session.completed webhook simulation —"
  info "  that path is unit-tested in store_user_profile_test.go and writing"
  info "  the same Redis fields directly exercises the same downstream code."
else
  fail "expected (200, active), got ($CODE, $STATUS)"
fi

# ── step 7: operator allowlist — Grant should never silence ─────────────────
step "Step 7: operator allowlist (Grant's real Slack ID never silences)"
GRANT_ID="${GRANT_SLACK_ID:-U0APBT3364D}"
INFO=$(status_for_slack "$GRANT_ID")
CODE="${INFO%%|*}" STATUS="${INFO##*|}"
if [ "$CODE" = "200" ] && [ "$STATUS" != "expired" ] ; then
  pass "user-status for $GRANT_ID returned $STATUS (not silenced)"
else
  fail "Grant ($GRANT_ID) resolved to ($CODE, $STATUS) — expected non-expired"
fi

# ── verdict ─────────────────────────────────────────────────────────────────
echo
if [ "$FAILED" -eq 0 ] ; then
  green "PASS — all programmatic checks green."
  info "Remaining manual verifications (see MANUAL VERIFY notes above):"
  info "  - Real trialing user gets normal replies (step 1)"
  info "  - Real expired user gets silent drop from both Ross + Joanne (step 5)"
  info "  - Joanne drain logs a Slack 404 for $TEST_SLACK_ID (step 3 confirms the queue, drain happens out-of-band)"
else
  red "FAIL — see ✗ lines above. Run with --keep to inspect leftover state, then --cleanup-only."
  exit 1
fi

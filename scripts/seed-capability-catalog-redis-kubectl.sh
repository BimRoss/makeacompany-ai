#!/usr/bin/env bash
# Seed production Redis with the capability catalog JSON from slack-orchestrator (same shape as NATS Capabilities).
# Fetches GET /debug/capability-catalog — does not use the admin HTTP API (reserved for /admin UI + Stripe OAuth).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config/admin.yaml}"
export KUBECONFIG
KCTX="${KUBECTL_CONTEXT:-admin}"
NS="makeacompany-ai"
DEPLOY="makeacompany-ai-redis"
KEY="makeacompany:catalog:capabilities:v1"

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://127.0.0.1:8080}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL%/}"
CATALOG_URL="${ORCHESTRATOR_CAPABILITY_CATALOG_URL:-$ORCHESTRATOR_URL/debug/capability-catalog}"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl_args=(-fsS -o "$TMP")
if [[ -n "${ORCHESTRATOR_DEBUG_TOKEN:-}" ]]; then
  curl_args+=(-H "Authorization: Bearer ${ORCHESTRATOR_DEBUG_TOKEN}")
fi

echo "Fetching catalog from ${CATALOG_URL}"
curl "${curl_args[@]}" "$CATALOG_URL"

if command -v jq >/dev/null 2>&1; then
  ORCH_DIR="${ORCHESTRATOR_GIT_DIR:-${REPO_ROOT}/../slack-orchestrator}"
  REV="${SOURCE_REVISION:-}"
  if [[ -z "$REV" ]] && git -C "$ORCH_DIR" rev-parse HEAD >/dev/null 2>&1; then
    REV="$(git -C "$ORCH_DIR" rev-parse HEAD)"
  fi
  REV="${REV:-orchestrator}"
  jq --arg rev "$REV" --arg src "bimross/slack-orchestrator+kubectl" --arg ua "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '. + {revision: $rev, source: $src, updatedAt: $ua}' "$TMP" >"${TMP}.out"
  mv "${TMP}.out" "$TMP"
else
  echo "warning: jq not found; seeding raw JSON without revision/updatedAt metadata" >&2
fi

kubectl --context "$KCTX" -n "$NS" exec -i "deploy/${DEPLOY}" -- redis-cli -x SET "$KEY" <"$TMP"
BYTES="$(wc -c <"$TMP" | tr -d ' ')"
echo "OK: SET ${KEY} (${BYTES} bytes) via deploy/${DEPLOY}"

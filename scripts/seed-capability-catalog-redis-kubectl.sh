#!/usr/bin/env bash
# Seed production Redis with capability catalog JSON (same shape as slack-factory/skills-catalog.json).
# Uses kubectl exec + redis-cli — does not call the admin HTTP API (reserved for /admin UI + Stripe OAuth).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_CATALOG="${REPO_ROOT}/../slack-factory/skills-catalog.json"
CATALOG_FILE="${1:-$DEFAULT_CATALOG}"

KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config/admin.yaml}"
export KUBECONFIG
KCTX="${KUBECTL_CONTEXT:-admin}"
NS="makeacompany-ai"
DEPLOY="makeacompany-ai-redis"
KEY="makeacompany:catalog:capabilities:v1"

if [[ ! -f "$CATALOG_FILE" ]]; then
  echo "Catalog file not found: $CATALOG_FILE" >&2
  echo "Usage: $0 [path/to/skills-catalog.json]" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if command -v jq >/dev/null 2>&1; then
  CATALOG_DIR="$(cd "$(dirname "$CATALOG_FILE")" && pwd)"
  REV="${SOURCE_REVISION:-}"
  if [[ -z "$REV" ]] && git -C "$CATALOG_DIR" rev-parse HEAD >/dev/null 2>&1; then
    REV="$(git -C "$CATALOG_DIR" rev-parse HEAD)"
  fi
  REV="${REV:-manual}"
  jq --arg rev "$REV" --arg src "bimross/slack-factory+kubectl" --arg ua "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '. + {revision: $rev, source: $src, updatedAt: $ua}' "$CATALOG_FILE" >"$TMP"
else
  cp "$CATALOG_FILE" "$TMP"
  echo "warning: jq not found; seeding raw file without revision/updatedAt metadata" >&2
fi

kubectl --context "$KCTX" -n "$NS" exec -i "deploy/${DEPLOY}" -- redis-cli -x SET "$KEY" <"$TMP"
BYTES="$(wc -c <"$TMP" | tr -d ' ')"
echo "OK: SET ${KEY} (${BYTES} bytes) via deploy/${DEPLOY}"

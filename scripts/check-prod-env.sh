#!/usr/bin/env bash
set -euo pipefail

# Validate required production env keys before secret sync / deploy operations.
# Usage:
#   ./scripts/check-prod-env.sh
#   ./scripts/check-prod-env.sh /path/to/.env.prod

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-${ROOT}/.env.prod}}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

require_var() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "${value}" ]]; then
    echo "missing required env: ${key} (file: ${ENV_FILE})" >&2
    return 1
  fi
  return 0
}

required_keys=(
  APP_BASE_URL
  NEXT_PUBLIC_SITE_URL
  NEXT_PUBLIC_BACKEND_API_BASE_URL
  KUBECONFIG_HOST_PATH
  KUBECONFIG_CONTEXT
  REDIS_URL
  STRIPE_WEBHOOK_SECRET
  STRIPE_PUBLISHABLE_KEY
  STRIPE_SECRET_KEY
  BACKEND_INTERNAL_SERVICE_TOKEN
  SLACK_BOT_TOKEN
  CAPABILITY_CATALOG_READ_TOKEN
  HEALTH_GRAFANA_CRON_DASHBOARD_URL
  HEALTH_GRAFANA_CRON_PANEL_IDS
  HEALTH_GRAFANA_CRON_PANEL_TITLES
)

failed=0
if [[ -z "${STRIPE_PRICE_ID_BASE_PLAN:-}" && -z "${STRIPE_PRICE_ID_WAITLIST:-}" ]]; then
  echo "missing STRIPE_PRICE_ID_BASE_PLAN (preferred; Stripe product \"Base Plan\" price_*) or legacy STRIPE_PRICE_ID_WAITLIST (${ENV_FILE})" >&2
  failed=1
fi
for key in "${required_keys[@]}"; do
  if ! require_var "${key}"; then
    failed=1
  fi
done

if [[ ${failed} -ne 0 ]]; then
  echo "prod env preflight failed: fill missing keys in ${ENV_FILE}" >&2
  exit 1
fi

echo "prod env preflight passed: ${ENV_FILE}"

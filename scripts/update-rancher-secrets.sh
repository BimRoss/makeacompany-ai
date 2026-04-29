#!/usr/bin/env bash
set -euo pipefail

# Push this app's Stripe (and related) runtime secrets to the admin Kubernetes cluster.
# Sources repo-root .env.prod (if present), else .env, unless ENV_FILE is set.
# Do not point this at .env.dev — production cluster secrets belong in .env.prod.
# Creates/updates Secret makeacompany-ai-runtime-secrets.
#
# By default also copies dockerhub-pull from namespace subnet-signal (fallback: bimross-web)
# so private geeemoney/* images can pull — same pattern as rancher-admin/scripts/sync-makeacompany-ai-pull-secret.sh.
# Set SYNC_PULL_SECRET=false to skip.
# After the Secret apply, by default restarts makeacompany-ai-backend + makeacompany-ai-frontend so
# envFrom reloads (e.g. rotated RESEND_API_KEY for /admin/login: Go sends mail; Next gates the email UI).
# Set ROLLOUT_AFTER_SECRET_SYNC=false to skip restarts.
#
# Keys (must match backend internal/app/config.go, docker-compose, .env.example, and slack-orchestrator for SLACK_BOT_TOKEN):
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET (required)
#   STRIPE_PRICE_ID_WAITLIST
#   STRIPE_PUBLISHABLE_KEY and/or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (optional; both written when either is set)
#   BACKEND_INTERNAL_SERVICE_TOKEN (required in production; Go /v1/internal/* maintenance endpoints only)
#   SLACK_BOT_TOKEN (optional; same as slack-orchestrator .env for /admin Slack Users users.list)
#   CAPABILITY_CATALOG_READ_TOKEN (optional; preserve existing token when omitted from .env.prod)
#   COOKIE_HEALTH_TOKEN (optional in .env, but preserved from existing runtime secret when present)
#   Portal login (optional; preserved from cluster when not in .env.prod — same Secret is envFrom on frontend + backend):
#   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, PORTAL_GOOGLE_OAUTH_STATE_SECRET (optional),
#   RESEND_API_KEY, PORTAL_AUTH_EMAIL_FROM,
#   RESEND_MAGIC_LINK_TEMPLATE_ID (optional; Resend template slug/id), RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR,
#   RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR (optional; override template variable keys)
#   JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN (optional; Bearer to employee-factory Joanne humans-welcome trigger; preserve from cluster when unset)
#
# Usage:
#   ./scripts/update-rancher-secrets.sh
#   ENV_FILE=/path/.env ./scripts/update-rancher-secrets.sh
#
# If ENV_FILE is unset and ${ROOT}/.env.prod exists, it is used (production cluster sync);
# otherwise ${ROOT}/.env.
#
# Kube: if KUBECONFIG is unset, uses ~/.kube/config/admin.yaml or grant-admin.yaml when present.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${KUBECONFIG:-}" ]]; then
  for _k in "${HOME}/.kube/config/admin.yaml" "${HOME}/.kube/config/grant-admin.yaml"; do
    if [[ -f "${_k}" ]]; then
      export KUBECONFIG="${_k}"
      break
    fi
  done
fi

if [[ -z "${ENV_FILE:-}" ]]; then
  if [[ -f "${ROOT}/.env.prod" ]]; then
    ENV_FILE="${ROOT}/.env.prod"
  else
    ENV_FILE="${ROOT}/.env"
  fi
fi
NAMESPACE="${NAMESPACE:-makeacompany-ai}"
SECRET_NAME="${SECRET_NAME:-makeacompany-ai-runtime-secrets}"
SYNC_PULL_SECRET="${SYNC_PULL_SECRET:-true}"
PULL_SECRET_NAME="${PULL_SECRET_NAME:-dockerhub-pull}"
PULL_SECRET_SOURCE_NAMESPACE="${PULL_SECRET_SOURCE_NAMESPACE:-subnet-signal}"
PULL_SECRET_FALLBACK_NAMESPACE="${PULL_SECRET_FALLBACK_NAMESPACE:-bimross-web}"

kubectl_app() {
  local args=()
  if [[ -n "${KUBE_CONTEXT:-}" ]]; then
    args+=(--context "${KUBE_CONTEXT}")
  fi
  kubectl "${args[@]}" "$@"
}

sync_pull_secret_from_subnet_signal() {
  local source_ns="${PULL_SECRET_SOURCE_NAMESPACE}"

  kubectl_app get namespace "${NAMESPACE}" >/dev/null 2>&1 || kubectl_app create namespace "${NAMESPACE}"

  if ! kubectl_app get secret "${PULL_SECRET_NAME}" -n "${source_ns}" >/dev/null 2>&1; then
    echo "Pull secret '${PULL_SECRET_NAME}' not found in '${source_ns}', trying '${PULL_SECRET_FALLBACK_NAMESPACE}'..."
    source_ns="${PULL_SECRET_FALLBACK_NAMESPACE}"
    kubectl_app get secret "${PULL_SECRET_NAME}" -n "${source_ns}" >/dev/null 2>&1 || {
      echo "Unable to find '${PULL_SECRET_NAME}' in '${PULL_SECRET_SOURCE_NAMESPACE}' or '${PULL_SECRET_FALLBACK_NAMESPACE}'." >&2
      exit 1
    }
  fi

  kubectl_app get secret "${PULL_SECRET_NAME}" -n "${source_ns}" -o json \
    | python3 -c 'import json,sys; src=json.load(sys.stdin); out={"apiVersion":"v1","kind":"Secret","metadata":{"name":src["metadata"]["name"],"namespace":"'"${NAMESPACE}"'"},"type":src.get("type"),"data":src.get("data",{})}; print(json.dumps(out))' \
    | kubectl_app apply -f -

  echo "Synced '${PULL_SECRET_NAME}' into namespace '${NAMESPACE}' from '${source_ns}'."
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

# Honor kube pointers often kept in .env.prod (must run before any kubectl_app).
if [[ -n "${KUBECONFIG_HOST_PATH:-}" && -f "${KUBECONFIG_HOST_PATH}" ]]; then
  export KUBECONFIG="${KUBECONFIG_HOST_PATH}"
fi
if [[ -n "${KUBECONFIG_CONTEXT:-}" && -z "${KUBE_CONTEXT:-}" ]]; then
  export KUBE_CONTEXT="${KUBECONFIG_CONTEXT}"
fi

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "need STRIPE_SECRET_KEY in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo "need STRIPE_WEBHOOK_SECRET in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${STRIPE_PRICE_ID_WAITLIST:-}" ]]; then
  echo "need STRIPE_PRICE_ID_WAITLIST in ${ENV_FILE}" >&2
  exit 1
fi

if [[ "${SYNC_PULL_SECRET}" == "true" ]]; then
  sync_pull_secret_from_subnet_signal
fi

read_existing_secret_key() {
  local key="$1"
  kubectl_app get secret "${SECRET_NAME}" -n "${NAMESPACE}" -o "jsonpath={.data.${key}}" 2>/dev/null \
    | python3 -c 'import sys,base64; raw=sys.stdin.read().strip(); print(base64.b64decode(raw).decode() if raw else "")' 2>/dev/null || true
}

secret_args=(--namespace "${NAMESPACE}")
secret_args+=(--from-literal=STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY}")
secret_args+=(--from-literal=STRIPE_PRICE_ID_WAITLIST="${STRIPE_PRICE_ID_WAITLIST}")
secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET}")

NPU="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-${STRIPE_PUBLISHABLE_KEY:-}}"
if [[ -n "${NPU}" ]]; then
  secret_args+=(--from-literal=NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="${NPU}")
  secret_args+=(--from-literal=STRIPE_PUBLISHABLE_KEY="${NPU}")
fi

# Preserve existing cookie token if local .env does not provide one.
COOKIE_HEALTH_TOKEN_EFFECTIVE="${COOKIE_HEALTH_TOKEN:-}"
if [[ -z "${COOKIE_HEALTH_TOKEN_EFFECTIVE}" ]]; then
  COOKIE_HEALTH_TOKEN_EFFECTIVE="$(read_existing_secret_key COOKIE_HEALTH_TOKEN)"
fi
if [[ -n "${COOKIE_HEALTH_TOKEN_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=COOKIE_HEALTH_TOKEN="${COOKIE_HEALTH_TOKEN_EFFECTIVE}")
fi

# Preserve existing internal maintenance token if local .env does not provide one.
BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE="${BACKEND_INTERNAL_SERVICE_TOKEN:-}"
if [[ -z "${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}" ]]; then
  BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE="$(read_existing_secret_key BACKEND_INTERNAL_SERVICE_TOKEN)"
fi
if [[ -z "${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}" ]]; then
  echo "need BACKEND_INTERNAL_SERVICE_TOKEN in ${ENV_FILE} (or already present in cluster secret ${SECRET_NAME})" >&2
  exit 1
fi
if [[ -n "${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=BACKEND_INTERNAL_SERVICE_TOKEN="${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}")
fi

# Optional Slack bot token (same key as slack-orchestrator; preserve from cluster when not in .env.prod).
SLACK_BOT_TOKEN_EFFECTIVE="${SLACK_BOT_TOKEN:-}"
if [[ -z "${SLACK_BOT_TOKEN_EFFECTIVE}" ]]; then
  SLACK_BOT_TOKEN_EFFECTIVE="$(read_existing_secret_key SLACK_BOT_TOKEN)"
fi
# One-time: migrate former makeacompany-only key into SLACK_BOT_TOKEN on the next secret apply.
if [[ -z "${SLACK_BOT_TOKEN_EFFECTIVE}" ]]; then
  SLACK_BOT_TOKEN_EFFECTIVE="$(read_existing_secret_key SLACK_WORKSPACE_USERS_BOT_TOKEN)"
fi
if [[ -n "${SLACK_BOT_TOKEN_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN_EFFECTIVE}")
fi

# Optional runtime catalog read token. Preserve existing cluster value when not present in ENV_FILE.
CAPABILITY_CATALOG_READ_TOKEN_EFFECTIVE="${CAPABILITY_CATALOG_READ_TOKEN:-}"
if [[ -z "${CAPABILITY_CATALOG_READ_TOKEN_EFFECTIVE}" ]]; then
  CAPABILITY_CATALOG_READ_TOKEN_EFFECTIVE="$(read_existing_secret_key CAPABILITY_CATALOG_READ_TOKEN)"
fi
if [[ -n "${CAPABILITY_CATALOG_READ_TOKEN_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=CAPABILITY_CATALOG_READ_TOKEN="${CAPABILITY_CATALOG_READ_TOKEN_EFFECTIVE}")
fi

# Optional portal auth keys (Google OAuth + Resend magic links). If absent from ENV_FILE, keep existing cluster values
# so a Stripe-only apply does not strip portal login.
add_optional_runtime_secret() {
  local key="$1"
  local from_env="${2:-}"
  local effective="${from_env}"
  if [[ -z "${effective}" ]]; then
    effective="$(read_existing_secret_key "${key}")"
  fi
  if [[ -n "${effective}" ]]; then
    secret_args+=(--from-literal="${key}=${effective}")
  fi
}

add_optional_runtime_secret GOOGLE_OAUTH_CLIENT_ID "${GOOGLE_OAUTH_CLIENT_ID:-}"
add_optional_runtime_secret GOOGLE_OAUTH_CLIENT_SECRET "${GOOGLE_OAUTH_CLIENT_SECRET:-}"
add_optional_runtime_secret PORTAL_GOOGLE_OAUTH_STATE_SECRET "${PORTAL_GOOGLE_OAUTH_STATE_SECRET:-}"
add_optional_runtime_secret RESEND_API_KEY "${RESEND_API_KEY:-}"
add_optional_runtime_secret PORTAL_AUTH_EMAIL_FROM "${PORTAL_AUTH_EMAIL_FROM:-}"
add_optional_runtime_secret RESEND_MAGIC_LINK_TEMPLATE_ID "${RESEND_MAGIC_LINK_TEMPLATE_ID:-}"
add_optional_runtime_secret RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR "${RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR:-}"
add_optional_runtime_secret RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR "${RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR:-}"
add_optional_runtime_secret JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN "${JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN:-}"

kubectl_app create secret generic "${SECRET_NAME}" \
  "${secret_args[@]}" \
  --dry-run=client -o yaml | kubectl_app apply -f -

echo "applied secret ${SECRET_NAME} in namespace ${NAMESPACE}"

ROLLOUT_AFTER_SECRET_SYNC="${ROLLOUT_AFTER_SECRET_SYNC:-true}"
if [[ "${ROLLOUT_AFTER_SECRET_SYNC}" == "true" ]]; then
  for dep in makeacompany-ai-backend makeacompany-ai-frontend; do
    if kubectl_app get deployment "${dep}" -n "${NAMESPACE}" >/dev/null 2>&1; then
      kubectl_app rollout restart "deployment/${dep}" -n "${NAMESPACE}"
      echo "rollout restart: ${dep}"
    fi
  done
fi

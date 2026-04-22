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
#
# Keys (must match backend internal/app/config.go and docker-compose / .env.example):
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET (required)
#   STRIPE_PRICE_ID_WAITLIST
#   STRIPE_PUBLISHABLE_KEY and/or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (optional; both written when either is set)
#   ADMIN_ALLOWED_EMAIL (enables /v1/admin/auth/* routes when set)
#   BACKEND_INTERNAL_SERVICE_TOKEN (optional; same value on Next server + Go backend for /v1/admin read APIs)
#   COOKIE_HEALTH_TOKEN (optional in .env, but preserved from existing runtime secret when present)
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

# Preserve existing admin email if local .env does not provide one.
ADMIN_ALLOWED_EMAIL_EFFECTIVE="${ADMIN_ALLOWED_EMAIL:-}"
if [[ -z "${ADMIN_ALLOWED_EMAIL_EFFECTIVE}" ]]; then
  ADMIN_ALLOWED_EMAIL_EFFECTIVE="$(read_existing_secret_key ADMIN_ALLOWED_EMAIL)"
fi
if [[ -n "${ADMIN_ALLOWED_EMAIL_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=ADMIN_ALLOWED_EMAIL="${ADMIN_ALLOWED_EMAIL_EFFECTIVE}")
fi

# Preserve existing internal read token if local .env does not provide one.
BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE="${BACKEND_INTERNAL_SERVICE_TOKEN:-}"
if [[ -z "${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}" ]]; then
  BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE="$(read_existing_secret_key BACKEND_INTERNAL_SERVICE_TOKEN)"
fi
if [[ -n "${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}" ]]; then
  secret_args+=(--from-literal=BACKEND_INTERNAL_SERVICE_TOKEN="${BACKEND_INTERNAL_SERVICE_TOKEN_EFFECTIVE}")
fi

kubectl_app create secret generic "${SECRET_NAME}" \
  "${secret_args[@]}" \
  --dry-run=client -o yaml | kubectl_app apply -f -

echo "applied secret ${SECRET_NAME} in namespace ${NAMESPACE}"

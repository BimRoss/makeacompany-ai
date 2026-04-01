#!/usr/bin/env bash
set -euo pipefail

# Push this app's Stripe (and related) runtime secrets to the admin Kubernetes cluster.
# Sources repo-root .env (or ENV_FILE). Creates/updates Secret makeacompany-ai-runtime-secrets.
#
# Keys (must match backend internal/app/config.go):
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST / STRIPE_WEBHOOK_SECRET_THIN_TEST (preferred), or
#   STRIPE_WEBHOOK_SECRET_SNAPSHOT / STRIPE_WEBHOOK_SECRET_THIN, or STRIPE_WEBHOOK_SECRET (legacy snapshot)
#   STRIPE_PRICE_ID_WAITLIST_TEST
#   STRIPE_PRICE_ID_WAITLIST_LIVE
#
# Optional alias: STRIPE_API_KEY_TEST is accepted as STRIPE_SECRET_KEY when the latter is unset.
#
# Usage:
#   ./scripts/update-rancher-secrets.sh
#   ENV_FILE=/path/.env ./scripts/update-rancher-secrets.sh
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

ENV_FILE="${ENV_FILE:-${ROOT}/.env}"
NAMESPACE="${NAMESPACE:-makeacompany-ai}"
SECRET_NAME="${SECRET_NAME:-makeacompany-ai-runtime-secrets}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-${STRIPE_API_KEY_TEST:-}}"

if [[ -z "${STRIPE_SECRET_KEY}" ]]; then
  echo "need STRIPE_SECRET_KEY or STRIPE_API_KEY_TEST in ${ENV_FILE}" >&2
  exit 1
fi
SNAP="${STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST:-${STRIPE_WEBHOOK_SECRET_SNAPSHOT:-${STRIPE_WEBHOOK_SECRET:-}}}"
THIN="${STRIPE_WEBHOOK_SECRET_THIN_TEST:-${STRIPE_WEBHOOK_SECRET_THIN:-}}"
if [[ -z "${SNAP}" && -z "${THIN}" ]]; then
  echo "need STRIPE_WEBHOOK_SECRET_*_TEST (or SNAPSHOT/THIN / legacy STRIPE_WEBHOOK_SECRET) in ${ENV_FILE}" >&2
  exit 1
fi
if [[ -z "${STRIPE_PRICE_ID_WAITLIST_TEST:-}" ]]; then
  echo "need STRIPE_PRICE_ID_WAITLIST_TEST in ${ENV_FILE}" >&2
  exit 1
fi
if [[ -z "${STRIPE_PRICE_ID_WAITLIST_LIVE:-}" ]]; then
  echo "need STRIPE_PRICE_ID_WAITLIST_LIVE in ${ENV_FILE}" >&2
  exit 1
fi

kubectl_args=()
if [[ -n "${KUBE_CONTEXT:-}" ]]; then
  kubectl_args+=(--context "${KUBE_CONTEXT}")
fi

secret_args=(
  --namespace "${NAMESPACE}"
  --from-literal=STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY}"
  --from-literal=STRIPE_PRICE_ID_WAITLIST_TEST="${STRIPE_PRICE_ID_WAITLIST_TEST}"
  --from-literal=STRIPE_PRICE_ID_WAITLIST_LIVE="${STRIPE_PRICE_ID_WAITLIST_LIVE}"
)
if [[ -n "${SNAP}" ]]; then
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST="${SNAP}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_SNAPSHOT="${SNAP}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET="${SNAP}")
fi
if [[ -n "${THIN}" ]]; then
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_THIN_TEST="${THIN}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_THIN="${THIN}")
fi

kubectl "${kubectl_args[@]}" create secret generic "${SECRET_NAME}" \
  "${secret_args[@]}" \
  --dry-run=client -o yaml | kubectl "${kubectl_args[@]}" apply -f -

echo "applied secret ${SECRET_NAME} in namespace ${NAMESPACE}"

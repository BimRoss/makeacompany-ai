#!/usr/bin/env bash
set -euo pipefail

# Push this app's Stripe (and related) runtime secrets to the admin Kubernetes cluster.
# Sources repo-root .env (or ENV_FILE). Creates/updates Secret makeacompany-ai-runtime-secrets.
#
# By default also copies dockerhub-pull from namespace subnet-signal (fallback: bimross-web)
# so private geeemoney/* images can pull — same pattern as rancher-admin/scripts/sync-makeacompany-ai-pull-secret.sh.
# Set SYNC_PULL_SECRET=false to skip.
#
# Keys (must match backend internal/app/config.go and docker-compose / .env.example):
#   Effective API key (first non-empty wins in the app): STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST,
#   STRIPE_SECRET_KEY_LIVE, STRIPE_API_KEY_TEST
#   STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST / STRIPE_WEBHOOK_SECRET_THIN_TEST (preferred), or
#   STRIPE_WEBHOOK_SECRET_SNAPSHOT / STRIPE_WEBHOOK_SECRET_THIN, or STRIPE_WEBHOOK_SECRET (legacy snapshot)
#   STRIPE_PRICE_ID_WAITLIST_TEST
#   STRIPE_PRICE_ID_WAITLIST_LIVE
#
# Optional publishable keys (public; also merged into ConfigMap makeacompany-ai-config as NEXT_PUBLIC_*):
#   STRIPE_PUBLISHABLE_KEY_TEST / STRIPE_PUBLISHABLE_KEY_LIVE or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_* 
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

STRIPE_SECRET_EFFECTIVE="${STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY_TEST:-${STRIPE_SECRET_KEY_LIVE:-${STRIPE_API_KEY_TEST:-}}}}"

if [[ -z "${STRIPE_SECRET_EFFECTIVE}" ]]; then
  echo "need at least one of STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, STRIPE_SECRET_KEY_LIVE, STRIPE_API_KEY_TEST in ${ENV_FILE}" >&2
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

if [[ "${SYNC_PULL_SECRET}" == "true" ]]; then
  sync_pull_secret_from_subnet_signal
fi

CONFIGMAP_NAME="${CONFIGMAP_NAME:-makeacompany-ai-config}"

append_literal_if_set() {
  local key="$1"
  local val="${!key:-}"
  if [[ -n "${val}" ]]; then
    secret_args+=(--from-literal="${key}=${val}")
  fi
}

secret_args=(--namespace "${NAMESPACE}")
append_literal_if_set STRIPE_SECRET_KEY
append_literal_if_set STRIPE_SECRET_KEY_TEST
append_literal_if_set STRIPE_SECRET_KEY_LIVE
append_literal_if_set STRIPE_PRICE_ID_WAITLIST_TEST
append_literal_if_set STRIPE_PRICE_ID_WAITLIST_LIVE
if [[ -n "${SNAP}" ]]; then
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST="${SNAP}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_SNAPSHOT="${SNAP}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET="${SNAP}")
fi
if [[ -n "${THIN}" ]]; then
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_THIN_TEST="${THIN}")
  secret_args+=(--from-literal=STRIPE_WEBHOOK_SECRET_THIN="${THIN}")
fi

kubectl_app create secret generic "${SECRET_NAME}" \
  "${secret_args[@]}" \
  --dry-run=client -o yaml | kubectl_app apply -f -

echo "applied secret ${SECRET_NAME} in namespace ${NAMESPACE}"

sync_publishable_configmap() {
  export NPU_TEST="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST:-${STRIPE_PUBLISHABLE_KEY_TEST:-}}"
  export NPU_LIVE="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE:-${STRIPE_PUBLISHABLE_KEY_LIVE:-}}"
  if [[ -z "${NPU_TEST}" && -z "${NPU_LIVE}" ]]; then
    return 0
  fi
  kubectl_app get configmap "${CONFIGMAP_NAME}" -n "${NAMESPACE}" -o json | python3 -c '
import json, os, sys
cm = json.load(sys.stdin)
data = cm.setdefault("data", {})
for key, env_name in (
    ("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST", "NPU_TEST"),
    ("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE", "NPU_LIVE"),
):
    v = os.environ.get(env_name, "").strip()
    if v:
        data[key] = v
json.dump(cm, sys.stdout)
' | kubectl_app apply -f -

  echo "updated ${CONFIGMAP_NAME} with NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_* (if set in ${ENV_FILE})"
}

sync_publishable_configmap

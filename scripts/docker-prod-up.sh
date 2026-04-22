#!/usr/bin/env bash
# Prod compose profile: local Next dev server + kubectl port-forwards to admin cluster.
# Passes --env-file .env.prod so KUBECONFIG_* interpolation (k8s-* volume mounts) matches frontend-prod defaults.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose --env-file .env.prod --profile prod "$@"

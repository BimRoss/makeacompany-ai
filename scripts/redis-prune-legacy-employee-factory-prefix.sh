#!/usr/bin/env bash
# Prune Redis keys matching the legacy squad prefix employee-factory:* (SCAN + UNLINK).
# Default is dry-run only. Use --execute after reviewing output.
#
# Requires: redis-cli (brew install redis) and REDIS_URL (same URL/db as makeacompany-ai + agent-factory shared Redis).
#
# Examples:
#   REDIS_URL='redis://127.0.0.1:6379/0' ./scripts/redis-prune-legacy-employee-factory-prefix.sh
#
# Prod (port-forward Redis, then local dry-run):
#   kubectl --context admin -n employee-factory port-forward svc/employee-factory-redis 16379:6379
#   REDIS_URL='redis://127.0.0.1:16379/0' ./scripts/redis-prune-legacy-employee-factory-prefix.sh
#   REDIS_URL='redis://127.0.0.1:16379/0' ./scripts/redis-prune-legacy-employee-factory-prefix.sh --execute
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EXECUTE=0
MATCH="${LEGACY_REDIS_MATCH:-employee-factory:*}"

usage() {
  echo "Usage: REDIS_URL=redis://... $0 [--dry-run|--execute]"
  echo "  --dry-run   Print keys that would be UNLINKed (default)."
  echo "  --execute   UNLINK every key matching LEGACY_REDIS_MATCH (default employee-factory:*)."
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=1 ;;
    --dry-run) EXECUTE=0 ;;
    -h|--help) usage ;;
    *)
      echo "unknown option: $arg" >&2
      usage
      ;;
  esac
done

if [[ -z "${REDIS_URL:-}" ]]; then
  echo "error: set REDIS_URL (e.g. redis://host:6379/0)" >&2
  exit 1
fi

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "error: redis-cli not on PATH (install Redis CLI, e.g. brew install redis)" >&2
  exit 1
fi

# Smoke: PING
if ! redis-cli -u "$REDIS_URL" PING | grep -q PONG; then
  echo "error: redis-cli -u REDIS_URL PING failed" >&2
  exit 1
fi

total=0
batch=()
flush_batch() {
  if [[ ${#batch[@]} -eq 0 ]]; then
    return 0
  fi
  if [[ "$EXECUTE" -eq 1 ]]; then
    redis-cli -u "$REDIS_URL" UNLINK "${batch[@]}" >/dev/null
  fi
  batch=()
}

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  total=$((total + 1))
  if [[ "$EXECUTE" -eq 0 ]]; then
    echo "DRY-RUN UNLINK: $key"
  else
    batch+=("$key")
    if [[ ${#batch[@]} -ge 128 ]]; then
      flush_batch
    fi
  fi
done < <(redis-cli -u "$REDIS_URL" --scan --pattern "$MATCH")

if [[ "$EXECUTE" -eq 1 ]]; then
  flush_batch
fi

echo ""
if [[ "$EXECUTE" -eq 0 ]]; then
  echo "Dry-run complete: ${total} key(s) matched pattern ${MATCH}"
  echo "Re-run with --execute on the same REDIS_URL to UNLINK them."
else
  echo "Execute complete: UNLINKed ${total} key(s) matching ${MATCH}"
fi

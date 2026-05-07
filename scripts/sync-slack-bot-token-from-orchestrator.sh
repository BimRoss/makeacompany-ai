#!/usr/bin/env bash
set -euo pipefail

# Copy the orchestrator Slack bot token from sibling slack-orchestrator into this repo's .env.dev or .env.prod.
# Reads ORCHESTRATOR_SLACK_BOT_TOKEN from the source first (multi-bot agents-mcp-server / slack-orchestrator
# layout), then falls back to legacy SLACK_BOT_TOKEN. Always writes ORCHESTRATOR_SLACK_BOT_TOKEN to the
# destination (the makeacompany-ai backend reads either, preferring ORCHESTRATOR_SLACK_BOT_TOKEN).
#
#   ./scripts/sync-slack-bot-token-from-orchestrator.sh dev
#   ./scripts/sync-slack-bot-token-from-orchestrator.sh prod
#
# Override orchestrator repo root (default: ../slack-orchestrator next to this repo):
#   SLACK_ORCHESTRATOR_ROOT=/path/to/slack-orchestrator ./scripts/sync-slack-bot-token-from-orchestrator.sh dev

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORCH="${SLACK_ORCHESTRATOR_ROOT:-$ROOT/../slack-orchestrator}"
MODE="${1:-}"

case "$MODE" in
  dev)
    SRC="$ORCH/.env.dev"
    DEST="$ROOT/.env.dev"
    ;;
  prod)
    SRC="$ORCH/.env.prod"
    DEST="$ROOT/.env.prod"
    ;;
  *)
    echo "usage: $0 dev|prod" >&2
    exit 2
    ;;
esac

if [[ ! -f "$SRC" ]]; then
  echo "error: missing source $SRC (set SLACK_ORCHESTRATOR_ROOT if orchestrator lives elsewhere)" >&2
  exit 1
fi
if [[ ! -f "$DEST" ]]; then
  echo "error: missing destination $DEST" >&2
  exit 1
fi

read_token() {
  local key="$1"
  grep -E "^[[:space:]]*${key}=" "$SRC" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

TOKEN="$(read_token ORCHESTRATOR_SLACK_BOT_TOKEN)"
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(read_token SLACK_BOT_TOKEN)"
fi
if [[ -z "$TOKEN" ]]; then
  echo "error: no ORCHESTRATOR_SLACK_BOT_TOKEN= or SLACK_BOT_TOKEN= line in $SRC" >&2
  exit 1
fi

export DEST SRC MODE TOKEN
python3 <<'PY'
from pathlib import Path
import re
import os

dest = Path(os.environ["DEST"])
src = Path(os.environ["SRC"])
mode = os.environ["MODE"]
token = os.environ["TOKEN"]
mark = f"# Same as slack-orchestrator/.env.{mode} (scripts/sync-slack-bot-token-from-orchestrator.sh)\n"
line = f"ORCHESTRATOR_SLACK_BOT_TOKEN={token}\n"

raw = dest.read_text()
if re.search(r"^\s*ORCHESTRATOR_SLACK_BOT_TOKEN=", raw, flags=re.M):
    raw = re.sub(r"^\s*ORCHESTRATOR_SLACK_BOT_TOKEN=.*\n?", line, raw, count=1, flags=re.M)
elif re.search(r"^\s*SLACK_BOT_TOKEN=", raw, flags=re.M):
    # In-place upgrade: replace legacy key with the new canonical key on first sync.
    raw = re.sub(r"^\s*SLACK_BOT_TOKEN=.*\n?", line, raw, count=1, flags=re.M)
else:
    raw = raw.rstrip() + "\n\n" + mark + line
dest.write_text(raw)
print(f"updated {dest} from {src}")
PY

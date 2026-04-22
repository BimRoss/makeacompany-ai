#!/usr/bin/env bash
set -euo pipefail

# Copy SLACK_BOT_TOKEN from sibling slack-orchestrator into this repo's .env.dev or .env.prod.
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

TOKEN="$(
  grep -E '^[[:space:]]*SLACK_BOT_TOKEN=' "$SRC" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
)"
if [[ -z "$TOKEN" ]]; then
  echo "error: no SLACK_BOT_TOKEN= line in $SRC" >&2
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
line = f"SLACK_BOT_TOKEN={token}\n"

raw = dest.read_text()
if re.search(r"^\s*SLACK_BOT_TOKEN=", raw, flags=re.M):
    raw = re.sub(r"^\s*SLACK_BOT_TOKEN=.*\n?", line, raw, count=1, flags=re.M)
else:
    raw = raw.rstrip() + "\n\n" + mark + line
dest.write_text(raw)
print(f"updated {dest} from {src}")
PY

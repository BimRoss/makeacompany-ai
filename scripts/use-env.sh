#!/usr/bin/env bash
# Link .env -> .env.dev or .env.prod so host Next.js / go run and other tools that read ./.env see the right file.
# Docker Compose defaults to .env.dev via MAKEACOMPANY_AI_ENV_FILE (see docker-compose.yml); this script is optional for compose.
# Usage: ./scripts/use-env.sh dev|prod
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
	echo "Usage: ${0##*/} dev|prod" >&2
	echo "Creates symlink .env -> .env.dev or .env.prod (both gitignored)." >&2
	echo "Use dev for npm run dev / go run; prod for host tools against prod secrets. Compose uses .env.dev unless MAKEACOMPANY_AI_ENV_FILE is set." >&2
	exit 1
}

case "${1:-}" in
dev | prod) ;;
*) usage ;;
esac

SRC=".env.$1"
if [[ ! -f "$SRC" ]]; then
	echo "error: $ROOT/$SRC not found — copy from .env.example and fill secrets." >&2
	exit 1
fi

rm -f .env
ln -sf "$SRC" .env
echo "Linked $ROOT/.env -> $SRC"

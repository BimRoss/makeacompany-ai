#!/usr/bin/env bash
# Create a Checkout Session via Stripe CLI matching backend handleCheckout (subscription mode).
# Uses STRIPE_PRICE_ID_BASE_PLAN (Stripe product "Base Plan"); falls back to legacy STRIPE_PRICE_ID_WAITLIST.
#
# Prerequisites: stripe CLI installed, logged in (`stripe login`) or STRIPE_API_KEY=sk_test_… set.
#
# Usage:
#   ./scripts/stripe-cli-base-plan-checkout-session.sh
#   STRIPE_PRICE_ID_BASE_PLAN=price_xxx ./scripts/stripe-cli-base-plan-checkout-session.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRICE="${STRIPE_PRICE_ID_BASE_PLAN:-${STRIPE_PRICE_ID_WAITLIST:-}}"
if [[ -z "$PRICE" && -f .env.dev ]]; then
	PRICE="$(grep -E '^[[:space:]]*STRIPE_PRICE_ID_BASE_PLAN=' .env.dev | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'" | xargs || true)"
fi
if [[ -z "$PRICE" && -f .env.dev ]]; then
	PRICE="$(grep -E '^[[:space:]]*STRIPE_PRICE_ID_WAITLIST=' .env.dev | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'" | xargs || true)"
fi
if [[ -z "$PRICE" ]]; then
	echo "error: set STRIPE_PRICE_ID_BASE_PLAN or define it in .env.dev (see .env.example)." >&2
	exit 1
fi

SUCCESS_URL="${CHECKOUT_SUCCESS_URL:-http://localhost:3000/?checkout=success&session_id={CHECKOUT_SESSION_ID}}"
CANCEL_URL="${CHECKOUT_CANCEL_URL:-http://localhost:3000/?checkout=cancelled}"

exec stripe checkout sessions create \
	-d mode=subscription \
	-d "success_url=${SUCCESS_URL}" \
	-d "cancel_url=${CANCEL_URL}" \
	-d "line_items[0][price]=${PRICE}" \
	-d "line_items[0][quantity]=1" \
	-d "metadata[source]=base_plan"

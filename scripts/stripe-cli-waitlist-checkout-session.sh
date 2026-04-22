#!/usr/bin/env bash
# Create a waitlist-style Checkout Session via Stripe CLI (payment mode + customer_creation=always).
# Matches backend handleCheckout behavior for customer creation; use for local QA or demos.
#
# Prerequisites: stripe CLI installed, logged in (`stripe login`) or STRIPE_API_KEY=sk_test_… set.
#
# Usage:
#   ./scripts/stripe-cli-waitlist-checkout-session.sh
#   STRIPE_PRICE_ID_WAITLIST=price_xxx ./scripts/stripe-cli-waitlist-checkout-session.sh
#   CHECKOUT_SUCCESS_URL='https://example.com/ok?session_id={CHECKOUT_SESSION_ID}' ./scripts/...
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRICE="${STRIPE_PRICE_ID_WAITLIST:-}"
if [[ -z "$PRICE" && -f .env.dev ]]; then
	PRICE="$(grep -E '^[[:space:]]*STRIPE_PRICE_ID_WAITLIST=' .env.dev | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'" | xargs || true)"
fi
if [[ -z "$PRICE" ]]; then
	echo "error: set STRIPE_PRICE_ID_WAITLIST or define it in .env.dev (see .env.example)." >&2
	exit 1
fi

SUCCESS_URL="${CHECKOUT_SUCCESS_URL:-http://localhost:3000/?checkout=success&session_id={CHECKOUT_SESSION_ID}}"
CANCEL_URL="${CHECKOUT_CANCEL_URL:-http://localhost:3000/?checkout=cancelled}"

exec stripe checkout sessions create \
	-d mode=payment \
	-d "success_url=${SUCCESS_URL}" \
	-d "cancel_url=${CANCEL_URL}" \
	--customer-creation always \
	-d "line_items[0][price]=${PRICE}" \
	-d "line_items[0][quantity]=1" \
	-d "metadata[source]=waitlist_cli"

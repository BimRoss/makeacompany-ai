#!/bin/sh
# POST makeacompany-ai internal snapshot endpoints with retries (local: backend may start after this container).
# Env: POST_URL, BACKEND_INTERNAL_SERVICE_TOKEN, optional SNAPSHOT_LABEL.
set -eu

POST_URL="${POST_URL:-}"
TOKEN="${BACKEND_INTERNAL_SERVICE_TOKEN:-}"
LABEL="${SNAPSHOT_LABEL:-snapshot-refresh}"

if [ -z "$POST_URL" ]; then
  echo "${LABEL}: skip (set POST_URL; see .env.example)"
  exit 0
fi
if [ -z "$TOKEN" ]; then
  echo "${LABEL}: skip (set BACKEND_INTERNAL_SERVICE_TOKEN for machine auth, or call POST_URL with Authorization: Bearer <mac_admin_session> when the service token is unset on the backend)"
  exit 0
fi

apk add --no-cache --quiet curl >/dev/null

max=45
delay=2
n=0
while [ "$n" -lt "$max" ]; do
  if curl -sfS -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      --max-time 120 \
      "$POST_URL" >/dev/null; then
    echo "${LABEL}: ok"
    exit 0
  fi
  n=$((n + 1))
  echo "${LABEL}: backend not ready yet (${n}/${max}), retry in ${delay}s..."
  sleep "$delay"
done

echo "${LABEL}: failed after ${max} attempts (POST_URL=${POST_URL})" >&2
exit 1

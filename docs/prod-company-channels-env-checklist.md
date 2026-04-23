# Prod checklist: Slack-first company channels

Use this when deploying or after a Redis **gut** of rebuildable `employee-factory:*` keys (see [redis-operations.md](redis-operations.md)). Goal: Next.js can proxy orchestrator debug routes and the Go backend can **upsert** `employee-factory:company_channels` via `POST /v1/admin/company-channels/discover`.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `ORCHESTRATOR_DEBUG_BASE_URL` | **Next.js** (frontend runtime) | Base URL for `GET /debug/member-channels` and `GET /debug/channel-members` (same host as slack-orchestrator HTTP). In cluster: in-cluster Service URL or port-forward target. `docker compose --profile prod` defaults to `http://k8s-orchestrator-forward:8080`. |
| `ORCHESTRATOR_DEBUG_TOKEN` | **Next.js** + optional **slack-orchestrator** | If orchestrator sets `ORCHESTRATOR_DEBUG_ALLOW_ANON=false`, set the **same** secret on both: Next sends `Authorization: Bearer`, orchestrator validates. If anon is allowed (default locally), leave empty. |
| `BACKEND_INTERNAL_API_BASE_URL` | **Next.js** | Server-side base for API routes that proxy to Go (e.g. `http://makeacompany-ai-backend:8080` in Kubernetes). |
| `ADMIN_SESSION_TOKEN` | Operator shell (one-shot scripts) | `mac_admin_session` bearer for direct `POST /v1/admin/company-channels/discover` calls from scripts/curl. |
| `BACKEND_INTERNAL_SERVICE_TOKEN` | **Go backend** | Optional bearer for `/v1/internal/*` maintenance endpoints only (snapshot refresh jobs). Not used for `/v1/admin/*` auth. |
| `COMPANY_CHANNELS_REDIS_URL` | **Go backend** | Optional second Redis URL for `employee-factory:*` keys. If unset, `REDIS_URL` is used for everything. **Recommended for prod:** point at the same Redis (or DB index) employee-factory uses so registry and bots agree; keeps `makeacompany:waitlist:*` on `REDIS_URL` only when using two instances/DBs. |
| `COMPANY_CHANNELS_REDIS_KEY` | **Go backend** | Hash name (default `employee-factory:company_channels`). Override only if your fleet uses a non-default name. |
| `SLACK_BOT_TOKEN` / Socket Mode | **slack-orchestrator** | Required for `/debug/member-channels` and `/debug/channel-members` to call Slack APIs. |

## Company portal sign-in (Google + email link)

| Variable | Where | Purpose |
|----------|--------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | **Next + Go** (runtime Secret in prod) | `/{channelId}/login` and `/admin/login` → Continue with Google. Register **`https://makeacompany.ai/api/portal/auth/google/callback`** in Google Cloud Console (admin reuses it). |
| `PORTAL_GOOGLE_OAUTH_STATE_SECRET` | **Next** (optional) | HMAC for OAuth `state`; min 16 chars, or omit to derive from client secret. |
| `RESEND_API_KEY` / `PORTAL_AUTH_EMAIL_FROM` | **Go + Next** (runtime Secret) | Magic sign-in links; `from` must be verified in Resend. |
| `APP_BASE_URL` | **Go** (ConfigMap) | Magic links use this origin (already `https://makeacompany.ai` in cluster). |

Push keys with **`./scripts/update-rancher-secrets.sh`** from **`.env.prod`**, then roll **frontend** and **backend** if needed.

## Verification commands

From an operator machine with network access to orchestrator and backend:

```bash
# Orchestrator lists channels the bot is in (adjust URL and token)
curl -sfS "${ORCHESTRATOR_DEBUG_BASE_URL}/debug/member-channels" \
  -H "Authorization: Bearer ${ORCHESTRATOR_DEBUG_TOKEN}" | head -c 400

# Humans in one channel
curl -sfS "${ORCHESTRATOR_DEBUG_BASE_URL}/debug/channel-members?channel_id=C01234567" \
  -H "Authorization: Bearer ${ORCHESTRATOR_DEBUG_TOKEN}" | head -c 400
```

Discover upsert (direct to Go; same body as [company-channels-discover-from-orchestrator.mjs](../scripts/company-channels-discover-from-orchestrator.mjs)):

```bash
curl -sS -X POST "${BACKEND_API_BASE_URL}/v1/admin/company-channels/discover" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_SESSION_TOKEN}" \
  -d '{"channels":[{"channel_id":"C01234567","name":"#example","owner_ids":["U01"]}]}'
```

## Automation

After envs are correct, run:

```bash
# With `.env` → `.env.dev` (./scripts/use-env.sh dev), `source .env.dev`, or vars exported:
node scripts/company-channels-discover-from-orchestrator.mjs
```

See script header for `DISCOVER_MAX_CHANNELS` and chunking (backend caps 200 channels per request; the script batches).

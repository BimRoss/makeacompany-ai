# Prod checklist: Slack-first company channels

Use this when deploying or after a Redis **gut** of rebuildable `employee-factory:*` keys (see [redis-operations.md](redis-operations.md)). Goal: Next.js can proxy orchestrator debug routes and the Go backend can **upsert** `employee-factory:company_channels` via `POST /v1/admin/company-channels/discover`.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `ORCHESTRATOR_DEBUG_BASE_URL` | **Next.js** (frontend runtime) | Base URL for `GET /debug/member-channels` and `GET /debug/channel-members` (same host as slack-orchestrator HTTP). In cluster: in-cluster Service URL or port-forward target. `docker compose --profile prod` defaults to `http://k8s-orchestrator-forward:8080`. |
| `ORCHESTRATOR_DEBUG_TOKEN` | **Next.js** + optional **slack-orchestrator** | If orchestrator sets `ORCHESTRATOR_DEBUG_ALLOW_ANON=false`, set the **same** secret on both: Next sends `Authorization: Bearer`, orchestrator validates. If anon is allowed (default locally), leave empty. |
| `BACKEND_INTERNAL_API_BASE_URL` | **Next.js** | Server-side base for API routes that proxy to Go (e.g. `http://makeacompany-ai-backend:8080` in Kubernetes). |
| `BACKEND_INTERNAL_SERVICE_TOKEN` | **Next.js** and **Go backend** | **Same** random secret in both. Used as `Authorization: Bearer` for `POST /v1/admin/company-channels/discover` and related admin read APIs. **Required in prod** when `BACKEND_INTERNAL_SERVICE_TOKEN` is set on the backend (otherwise discover returns 401). |
| `COMPANY_CHANNELS_REDIS_URL` | **Go backend** | Optional second Redis URL for `employee-factory:*` keys. If unset, `REDIS_URL` is used for everything. **Recommended for prod:** point at the same Redis (or DB index) employee-factory uses so registry and bots agree; keeps `makeacompany:waitlist:*` on `REDIS_URL` only when using two instances/DBs. |
| `COMPANY_CHANNELS_REDIS_KEY` | **Go backend** | Hash name (default `employee-factory:company_channels`). Override only if your fleet uses a non-default name. |
| `SLACK_BOT_TOKEN` / Socket Mode | **slack-orchestrator** | Required for `/debug/member-channels` and `/debug/channel-members` to call Slack APIs. |

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
  -H "Authorization: Bearer ${BACKEND_INTERNAL_SERVICE_TOKEN}" \
  -d '{"channels":[{"channel_id":"C01234567","name":"#example","owner_ids":["U01"]}]}'
```

## Automation

After envs are correct, run:

```bash
# Load .env then:
node scripts/company-channels-discover-from-orchestrator.mjs
```

See script header for `DISCOVER_MAX_CHANNELS` and chunking (backend caps 200 channels per request; the script batches).

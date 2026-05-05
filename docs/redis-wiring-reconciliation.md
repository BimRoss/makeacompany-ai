# Redis wiring reconciliation (makeacompany-ai, employee-factory, agent-factory)

This doc is the **source of truth** for which processes talk to which Redis and which key prefixes they expect. Use it when debugging “401 after login”, empty company-channel registries, or “works locally, wrong in prod”.

Repo path: `docs/redis-wiring-reconciliation.md` (this file).

## Physical Redis (production cluster)

| Workload | `REDIS_URL` (GitOps) | Notes |
|----------|----------------------|--------|
| **makeacompany-ai-backend** | `redis://employee-factory-redis.employee-factory.svc.cluster.local:6379/0` | Single primary client for waitlist, Stripe snapshots, **admin sessions** (`makeacompany:admin_session:*`), catalog snapshots, and (when `COMPANY_CHANNELS_REDIS_URL` is unset) company-channel registry reads/writes. |
| **employee-factory** (Slack workers, if deployed) | Same host/db `...6379/0` | Legacy layout used `employee-factory:*` keys; new prod stacks align **agent-factory + makeacompany** on `agent-factory:*` for shared registry/digests. |
| **agent-factory** (admin + workers) | From **`agent-factory-runtime`** secret (not in this repo) | Must point at the **same** Redis instance/db as above if workers and makeacompany are to share company-channel state. `agent-factory-config` sets **key names**; match the same values on **makeacompany-ai-config** (`COMPANY_CHANNELS_REDIS_KEY`, `CAPABILITY_ROUTING_EVENTS_REDIS_KEY`, `CHANNEL_KNOWLEDGE_REDIS_KEY_FMT`, `COMPANY_CHANNELS_INVALIDATE_CHANNEL`, `THREAD_OWNER_REDIS_KEY_SCAN_PATTERN`). |

Admin sessions are **always** stored on the **primary** Redis client in makeacompany-ai (`NewStore`’s first URL), under:

- `makeacompany:admin_session:<token>` (hash)

They do **not** use `COMPANY_CHANNELS_REDIS_URL`. If OAuth mint succeeds but `/v1/admin/auth/me` returns 401, suspect: wrong `REDIS_URL` for the backend pod, wrong DB index (`/0` vs `/1`), or session TTL/eviction — not the company-channel secondary URL.

## Key prefix conventions

| Prefix | Owner / consumers |
|--------|-------------------|
| `makeacompany:*` | makeacompany-ai-backend (waitlist, admin session, Slack snapshot blobs, Stripe admin snapshots, etc.) |
| `employee-factory:*` | Legacy employee-factory workers / old data (still in Redis until cleaned) |
| `agent-factory:*` | agent-factory + makeacompany-ai-backend shared registry, routing events list, channel-knowledge strings, invalidate pub/sub, and admin prune patterns for `thread_owner` keys |

**Production (rancher-admin):** `agent-factory-config` and `makeacompany-ai-config` use the same **`agent-factory:*`** key names so the site admin UI and workers see one registry (blank slate on first rollout; old `employee-factory:*` keys are orphaned until TTL/manual delete).

**Local `agent-factory/docker-compose.core.yml`:** defaults use the same **`agent-factory:*`** names on the compose `redis` service — mirror prod by keeping GitOps env aligned with compose.

## Reconciliation checklist (when something “moved to agent-factory”)

1. **makeacompany-ai-backend** `REDIS_URL` in cluster → must match where you expect `makeacompany:admin_session:*` to live (today: **employee-factory-redis**).
2. **agent-factory-runtime** `REDIS_URL` (secret) → should be the **same** URL/db as (1) if agents read/write shared registry keys.
3. **`COMPANY_CHANNELS_REDIS_URL`** on makeacompany-ai → leave **unset** unless you intentionally split registries (backend logs “secondary client” when it differs).
4. **DB index** → keep everything on `/0` unless you have an explicit multi-tenant reason; mixing `/0` and `/1` looks like “wrong Redis”.
5. **Quick probe** (from a shell with `kubectl` + cluster access): exec into makeacompany-ai-backend, `redis-cli -u "$REDIS_URL" KEYS 'makeacompany:admin_session:*'` (or `SCAN`) after a login attempt — keys should appear if mint + Redis write succeeded.

## Optional Next.js debug route

With **`ADMIN_AUTH_DEBUG=1`** on the frontend, `GET /api/admin/auth/debug` returns cookie presence and the HTTP status from proxying `GET /v1/admin/auth/me` (no token in response). Remove the flag after investigation.

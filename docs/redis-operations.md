# makeacompany-ai Redis (production)

## Shape

- Redis Service: `makeacompany-ai-redis`
- Namespace: `makeacompany-ai`
- GitOps: `rancher-admin/admin/apps/makeacompany-ai/redis.yaml`
- Persistence: AOF + RDB-style backup cron (see manifest)
- Data volume: PVC `makeacompany-ai-redis-data` (node **makeacompany**)
- Backups volume: PVC `makeacompany-ai-redis-backups` (node **website**)
- Backup job: CronJob `makeacompany-ai-redis-backup` (every 30 minutes, 14-day retention)

## Key prefix matrix (quick reference)

| Prefix / key | Redis connection | Notes |
|----------------|------------------|--------|
| `makeacompany:*` | `REDIS_URL` (backend) | Waitlist, checkout idempotency, stats, admin sessions, optional catalog JSON. **Sacred** for paid signups — see [Prod reset](#prod-reset-gut--sacred-vs-rebuildable). |
| `employee-factory:company_channels` | `COMPANY_CHANNELS_REDIS_URL` or `REDIS_URL` | Per-channel registry JSON. **Rebuild** from Slack via `/admin` discover or [`scripts/company-channels-discover-from-orchestrator.mjs`](../scripts/company-channels-discover-from-orchestrator.mjs). |
| `employee-factory:channel_knowledge:*`, `employee-factory:capability_routing_events`, `employee-factory:thread_owner:*` | Same as company registry | Rebuildable; see [Prod reset](#prod-reset-gut--sacred-vs-rebuildable). |

**Prod recommendation:** Set `COMPANY_CHANNELS_REDIS_URL` to the Redis (or logical DB) shared with **employee-factory** so company-channel HASH and bots stay aligned, while `REDIS_URL` can remain the makeacompany-ai app instance for waitlist-only isolation when you run two databases. If you use a **single** Redis DB, use **SCAN + DEL** by prefix instead of `FLUSHDB`. Env checklist: [prod-company-channels-env-checklist.md](prod-company-channels-env-checklist.md).

## Keys

- `makeacompany:catalog:capabilities:v1` — JSON used for **makeacompany.ai** `/employees`, `/skills`, and `GET/PUT /v1/admin/catalog` only. **Slack bots do not read this key** — runtime skills and assignments come from **slack-orchestrator** (capabilities on dispatch → NATS → employee-factory). Safe to `DEL` this key for a prod reset: the backend merges **code defaults** on read (`mergeCapabilityCatalogWithDefaults`). Omit or ignore Redis seeding while admin stays read-only and orchestrator is the live contract.
- `makeacompany:checkout:<stripe_checkout_session_id>` — idempotency marker
- `makeacompany:waitlist:<email>` — hash of waitlist signup fields

### Shared employee-factory namespace (often same Redis instance or `COMPANY_CHANNELS_REDIS_URL`)

When the backend uses a second client or the same DB, these prefixes may appear:

- `employee-factory:company_channels` — HASH (per-channel JSON); **repopulate** via `/admin` Companies flow (`POST .../discover`) using Slack as source of truth, or future event hooks.
- `employee-factory:channel_knowledge:*` — digest cache; rebuilds from jobs.
- `employee-factory:capability_routing_events` — ops/debug LIST.
- `employee-factory:thread_owner:*` — ephemeral thread attribution.

## Prod reset (“gut”) — sacred vs rebuildable

**Do not delete (sacred)** — paid waitlist and billing continuity:

- `makeacompany:waitlist:*`, `makeacompany:checkout:*`, `makeacompany:stats:*` (and any Stripe-related state tied to those flows).

**Safe to clear (rebuildable)** — Slack + jobs restore behavior:

- All `employee-factory:*` keys listed above.
- `makeacompany:catalog:capabilities:v1` — optional; losing it only affects marketing/admin catalog pages until defaults apply or you write again.

**Never `FLUSHDB`** on a shared DB that still holds waitlist rows. Prefer **SCAN + DEL** by prefix, or **separate Redis DB index / `COMPANY_CHANNELS_REDIS_URL`** so app waitlist and shared registry can be managed independently.

**After a gut:** deploy orchestrator + backend + Next; open `/admin` so the Companies strip runs discover, or run `node scripts/company-channels-discover-from-orchestrator.mjs` (see [prod-company-channels-env-checklist.md](prod-company-channels-env-checklist.md)). See root `README.md` for `ORCHESTRATOR_DEBUG_BASE_URL` in compose.

### Seed catalog from slack-factory (kubectl)

From a machine with **`kubectl`** access to the **admin** cluster (`KUBECONFIG` fragment + `--context admin` per BimRoss kubeconfig rules):

```bash
cd /path/to/makeacompany-ai
./scripts/seed-capability-catalog-redis-kubectl.sh /path/to/slack-factory/skills-catalog.json
```

Default first argument: `../slack-factory/skills-catalog.json` relative to the makeacompany-ai repo root. Uses `jq` when installed to set `revision`, `source`, and `updatedAt` on the payload.

Verifies Redis is reachable:

```bash
kubectl --context admin -n makeacompany-ai exec deploy/makeacompany-ai-redis -- redis-cli STRLEN makeacompany:catalog:capabilities:v1
```

## Admin API (PII)

`GET /v1/admin/waitlist` returns waitlist hash rows (emails, Stripe identifiers). It requires the same **admin session** `Authorization: Bearer …` as other `/v1/admin/*` routes (`adminAuthEnabled`, `validateAdminSession`). Call from a trusted client only.

## Verify

```bash
kubectl -n makeacompany-ai get pod,svc,pvc | rg makeacompany-ai-redis
kubectl -n makeacompany-ai get cronjob | rg makeacompany-ai-redis-backup
```

See `rancher-admin/admin/apps/makeacompany-ai/redis-restore.md` for restore outline (if present).

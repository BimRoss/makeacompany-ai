# makeacompany-ai Redis (production)

## Shape

- Redis Service: `makeacompany-ai-redis`
- Namespace: `makeacompany-ai`
- GitOps: `rancher-admin/admin/apps/makeacompany-ai/redis.yaml`
- Persistence: AOF + RDB-style backup cron (see manifest)
- Data volume: PVC `makeacompany-ai-redis-data` (node **makeacompany**)
- Backups volume: PVC `makeacompany-ai-redis-backups` (node **website**)
- Backup job: CronJob `makeacompany-ai-redis-backup` (every 30 minutes, 14-day retention)

## Keys

- `makeacompany:catalog:capabilities:v1` — JSON capability catalog (`GET`/`PUT` shape matches `slack-factory/skills-catalog.json`; backend normalizes/validates on read). Seed with ops script (kubectl), not the admin HTTP API — admin API is for `/admin` UI and Stripe session flows.
- `makeacompany:checkout:<stripe_checkout_session_id>` — idempotency marker
- `makeacompany:waitlist:<email>` — hash of waitlist signup fields

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

`GET /v1/admin/waitlist` returns waitlist hash rows for the site `/twitter` table. It is **unauthenticated** today and exposes emails and Stripe identifiers. Add auth (or network restriction) before relying on it under broad traffic.

## Verify

```bash
kubectl -n makeacompany-ai get pod,svc,pvc | rg makeacompany-ai-redis
kubectl -n makeacompany-ai get cronjob | rg makeacompany-ai-redis-backup
```

See `rancher-admin/admin/apps/makeacompany-ai/redis-restore.md` for restore outline (if present).

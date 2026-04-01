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

- `makeacompany:checkout:<stripe_checkout_session_id>` — idempotency marker
- `makeacompany:waitlist:<email>` — hash of waitlist signup fields

## Admin API (PII)

`GET /v1/admin/waitlist` returns waitlist hash rows for the site `/admin` table. It is **unauthenticated** today and exposes emails and Stripe identifiers. Add auth (or network restriction) before relying on it under broad traffic.

## Verify

```bash
kubectl -n makeacompany-ai get pod,svc,pvc | rg makeacompany-ai-redis
kubectl -n makeacompany-ai get cronjob | rg makeacompany-ai-redis-backup
```

See `rancher-admin/admin/apps/makeacompany-ai/redis-restore.md` for restore outline (if present).

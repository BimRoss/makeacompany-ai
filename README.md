# makeacompany.ai

Source: [github.com/BimRoss/makeacompany-ai](https://github.com/BimRoss/makeacompany-ai)

Marketing landing page and **$1 Stripe waitlist** for [makeacompany.ai](https://makeacompany.ai), with a Go API and Redis persistence. Stack mirrors BimRoss patterns (Thread Pilot–style billing hooks, Subnet Signal–style Redis backups in GitOps).

## Repo layout

- `backend/` — Go HTTP server: health, `POST /v1/billing/checkout`, `POST /v1/billing/webhook`
- `src/` — Next.js (App Router) single-page site, `next-themes` light/dark
- `deploy/docker/` — production Dockerfiles
- `admin/apps/makeacompany-ai/` — lives in **`bimross/rancher-admin`** (Fleet / admin cluster)

## Local development

Copy `.env.example` to `.env` and set Stripe test keys and price ids.

```bash
# Redis + API + Next (hot reload for frontend)
docker compose --profile local up --build
```

- Site: http://localhost:3000  
- API: http://localhost:8080  

Or run Redis via Docker and:

```bash
cd backend && go run ./cmd/makeacompany-ai-backend
npm run dev   # repo root
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Redis connection URL |
| `APP_BASE_URL` | Public site URL (Stripe success/cancel) |
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `STRIPE_PRICE_ID_WAITLIST_TEST` | $1 one-time price (test mode) |
| `STRIPE_PRICE_ID_WAITLIST_LIVE` | $1 one-time price (live mode) |

Checkout selects test vs live **price** from `STRIPE_SECRET_KEY` mode (`sk_live_` uses live price id).

## CI/CD

GitHub Actions: [.github/workflows/makeacompany-ai-images.yml](.github/workflows/makeacompany-ai-images.yml)

- On **`v*`** tags: build and push `geeemoney/makeacompany-ai-frontend` and `geeemoney/makeacompany-ai-backend`, then bump image tags in **`bimross/rancher-admin`** (`admin/apps/makeacompany-ai/*.yaml`).

### Repository secrets

| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub login |
| `DOCKERHUB_TOKEN` | Docker Hub push |
| `RANCHER_ADMIN_REPO_TOKEN` | PAT with push access to **`bimross/rancher-admin`** (for `gitops-release` only) |

Add these in the GitHub repo **Settings → Secrets and variables → Actions** before relying on tagged releases.

## Kubernetes (operator)

Manifests: `rancher-admin/admin/apps/makeacompany-ai/`

- Workloads run on node **`makeacompany`**; Redis backup volume on **`website`** (same pattern as Subnet Signal).
- Ensure host paths exist on nodes before binding PVs (e.g. `/var/lib/makeacompany-ai/redis-data` on `makeacompany`).
- Create a **`makeacompany-ai-runtime-secrets`** Secret (or SealedSecret) with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_WAITLIST_TEST`, `STRIPE_PRICE_ID_WAITLIST_LIVE` — referenced optionally by the backend Deployment until applied.

## Docs

- [docs/redis-operations.md](docs/redis-operations.md)

## License

Proprietary — BimRoss.

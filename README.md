# makeacompany.ai

Source: [github.com/BimRoss/makeacompany-ai](https://github.com/BimRoss/makeacompany-ai)

Marketing landing page and **$1 Stripe waitlist** for [makeacompany.ai](https://makeacompany.ai), with a Go API and Redis persistence. Stack mirrors BimRoss patterns (Thread Pilot–style billing hooks, Subnet Signal–style Redis backups in GitOps).

## Repo layout

- `backend/` — Go HTTP server: health, `POST /v1/billing/checkout`, `POST /v1/billing/webhook`
- `src/` — Next.js (App Router) single-page site, `next-themes` light/dark
- `src/app/employees/` — operator control surface (`/employees`) with Team cards
- `deploy/docker/` — production Dockerfiles
- `admin/apps/makeacompany-ai/` — lives in **`bimross/rancher-admin`** (Fleet / admin cluster)

## Employees control surface

- Route: `/employees`
- Current module: **Team** (desktop/mobile responsive cards)
- Data source: Redis-backed capability catalog via backend `GET /v1/admin/catalog`
- Chart source: Grafana panels backed by `employee-factory` Prometheus metrics, filtered per employee (`Activities`, `Requests /min`, and per-tool usage breakdown).
- `No data` on a card means that employee has no matching Slack runtime events/posts in the current chart lookback window (default: last hour). Cursor/IDE usage does not affect these counters.
- Quick checks: confirm the employee bot is running and receiving Slack traffic, then recheck the dashboard window after activity.

Sync team data into this repo:

```bash
npm run sync:team
```

Generated fallback files:

- `src/data/admin/team-snapshot.json`

Admin catalog editor:

- Route: `/admin`
- Proxy endpoint: `GET/PUT /api/admin/catalog` -> backend `GET/PUT /v1/admin/catalog`
- `PUT` forwards optional `X-Admin-Token` (backend validates against `ADMIN_CATALOG_TOKEN` when set).
- Sign-in route: `/admin/login` starts Stripe-backed verification before issuing an HttpOnly admin session cookie.
- Capability catalog is authoritative for Slack tooling assignments. `employee-factory` only executes a tool when `/admin` assigns that tool to the employee and runtime secrets/env are ready.
- Backend rejects unsupported `runtimeTool` values on `PUT /v1/admin/catalog` so admin assignments cannot drift from runtime-supported tool keys.

## Stripe catalog (`stripe-factory`)

**Products and prices** for this app are defined in **[bimross/stripe-factory](https://github.com/BimRoss/stripe-factory)** (Terraform: test vs live). After `terraform apply`, copy the output **`makeacompany_waitlist_price_id`** into `STRIPE_PRICE_ID_WAITLIST_TEST` / `STRIPE_PRICE_ID_WAITLIST_LIVE` here or in cluster secrets.

- Webhook events: `webhooks/makeacompany-ai.events.txt` in that repo.
- Local webhooks: Stripe CLI — see **`stripe-factory` → `docs/LOCAL.md`**.

## Local development

Copy `.env.example` to `.env` and set Stripe test keys and price ids.

```bash
# Redis + API + Next (hot reload for frontend)
docker compose --profile local up --build
```

- Site: http://localhost:3000  
- API: http://localhost:8080  

```bash
# Frontend dev server + admin-cluster backend via compose-managed kubectl port-forward
docker compose --profile prod up --build
```

- Site: http://localhost:3000
- Prod backend forward: http://localhost:18080
- Required env for this profile: `KUBECONFIG_HOST_PATH` (for example `/Users/grant/.kube/config/admin.yaml`)
- `frontend-prod` waits for the backend port-forward service to report healthy before startup.

Quick checks if `/employees` data looks wrong:

```bash
docker compose --profile prod ps
curl -sf http://localhost:18080/health >/dev/null && echo "backend forward OK"
```

Or run Redis via Docker and:

```bash
cd backend && go run ./cmd/makeacompany-ai-backend
npm run dev   # repo root
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Redis connection URL |
| `ADMIN_CATALOG_TOKEN` | Optional shared token required for backend `PUT /v1/admin/catalog` (`X-Admin-Token` header) |
| `ADMIN_ALLOWED_EMAIL` | Required email allowed to establish `/admin` session after Stripe auth completes |
| `ADMIN_SESSION_TTL_SEC` | Admin session lifetime in seconds (default `259200`) |
| `APP_BASE_URL` | Public site URL (Stripe success/cancel) |
| `BACKEND_INTERNAL_API_BASE_URL` | Server-side internal backend base for Next route handlers (defaults to localhost locally and service DNS in Kubernetes) |
| `KUBECONFIG_HOST_PATH` | Local kubeconfig path mounted into compose `k8s-*` port-forward services (used by `--profile prod`) |
| `KUBECONFIG_CONTEXT` | Kubernetes context for compose `k8s-*` forwards (defaults to `admin`) |
| `PROD_BACKEND_PORT` | Host port for forwarded `makeacompany-ai-backend` service (defaults to `18080`) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 stream id injected into frontend at build time |
| `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` | LinkedIn Insight Tag partner id; frontend injects LinkedIn tracking only in production when set |
| `STRIPE_SECRET_KEY` | Optional single key (`sk_test_…` or `sk_live_…`) — wins if set |
| `STRIPE_SECRET_KEY_TEST` / `STRIPE_SECRET_KEY_LIVE` | Split keys; backend picks the **first non-empty** in order: `STRIPE_SECRET_KEY`, `STRIPE_SECRET_KEY_LIVE`, `STRIPE_SECRET_KEY_TEST`, `STRIPE_API_KEY_TEST` |
| `STRIPE_API_KEY_TEST` | Optional alias (e.g. stripe-factory) for a test secret key |
| `STRIPE_PUBLISHABLE_KEY_*` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_*` | Public keys for Stripe.js; compose maps `STRIPE_PUBLISHABLE_KEY_*` → `NEXT_PUBLIC_*` for the frontend container |
| `STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST` | Test-mode signing secret for **snapshot** webhook destination (`whsec_…`) |
| `STRIPE_WEBHOOK_SECRET_THIN_TEST` | Test-mode signing secret for **thin** webhook destination (same URL path, different `whsec`) |
| `STRIPE_WEBHOOK_SECRET_SNAPSHOT` / `STRIPE_WEBHOOK_SECRET_THIN` | Optional aliases if you omit the `_TEST` suffix |
| `STRIPE_WEBHOOK_SECRET` | Optional legacy: used as snapshot secret if snapshot-specific vars are unset |
| `STRIPE_PRICE_ID_WAITLIST_TEST` | $1 one-time price (test mode) |
| `STRIPE_PRICE_ID_WAITLIST_LIVE` | $1 one-time price (live mode) |
| `HEALTH_GRAFANA_DASHBOARD_URL` | App observability dashboard URL used by `/employees` and `/twitter` |
| `HEALTH_GRAFANA_PANEL_IDS` / `HEALTH_GRAFANA_PANEL_TITLES` | App panel ids/titles for the admin APIs |
| `HEALTH_GRAFANA_TWITTER_DASHBOARD_URL` | Twitter dashboard URL for `/twitter` embeds |
| `HEALTH_GRAFANA_TWITTER_PANEL_IDS` / `HEALTH_GRAFANA_TWITTER_PANEL_TITLES` | Twitter panel ids/titles for `/twitter` embeds |
| `HEALTH_TWITTER_INDEXER_URL` | Internal twitter-indexer base URL used by backend `/health` and recent-request proxy |
| `HEALTH_TWITTER_WORKER_URLS` | Comma-separated twitter worker service URLs for backend worker checks |
| `HEALTH_PROMETHEUS_URL` | Optional Prometheus endpoint used for monitoring status |
| `HEALTH_GRAFANA_URL` | Optional Grafana endpoint used for monitoring status |
| `HEALTH_COOKIE_STALE_AFTER_MINUTES` | Max age before cookie health payload is marked stale |
| `COOKIE_HEALTH_TOKEN` | Shared auth token for `POST /api/internal/cookie-health` |

**Webhook URL (POST):** `{backend origin}/v1/billing/webhook` — e.g. ngrok `https://YOUR_SUBDOMAIN.ngrok-free.dev/v1/billing/webhook` forwarding to `localhost:8080`. Snapshot and thin destinations can share this path; each destination still has its own signing secret.

Checkout selects test vs live **price** from the **effective** API secret’s prefix (`sk_live_` uses live price id). For **production**, prefer `STRIPE_SECRET_KEY` (live) or `STRIPE_SECRET_KEY_LIVE`.

**`NEXT_PUBLIC_*` in Kubernetes:** GA + site defaults come from ConfigMap **`makeacompany-ai-config`**; Stripe publishable keys now come from Secret **`makeacompany-ai-runtime-secrets`**. Client-bundled `NEXT_PUBLIC_*` in a production **Docker** image are fixed at **`npm run build`** unless you add build-args in CI; set publishable keys in the image build when the frontend starts using Stripe.js in the browser. The same build-time rule applies to `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` for LinkedIn Insight in production.

### Admin cluster (runtime Secret)

From a machine with `kubectl` access to the **admin** cluster:

```bash
./scripts/update-rancher-secrets.sh
```

Reads repo-root `.env` and applies Secret **`makeacompany-ai-runtime-secrets`** in namespace **`makeacompany-ai`** (Stripe runtime keys + price + webhook keys). It always writes an effective `STRIPE_SECRET_KEY`, preferring live when split keys are present. If `STRIPE_PUBLISHABLE_KEY_*` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_*` are set, it also writes **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`** / **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE`** into the same runtime Secret so frontend/backend can consume them via `envFrom.secretRef`. Catalog price ids often originate in **[stripe-factory](https://github.com/BimRoss/stripe-factory)**; you can also run **`stripe-factory/scripts/update-rancher-secrets.sh`** from that repo if your Stripe material lives there.

## CI/CD

GitHub Actions: [.github/workflows/makeacompany-ai-images.yml](.github/workflows/makeacompany-ai-images.yml)

- On **`v*`** tags: build and push `geeemoney/makeacompany-ai-frontend` and `geeemoney/makeacompany-ai-backend`, then bump image tags in **`bimross/rancher-admin`** (`admin/apps/makeacompany-ai/*.yaml`).

### GA setup contract

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` must exist as a GitHub **repository variable**.
- The frontend Docker image bakes `NEXT_PUBLIC_*` values at `npm run build` time. If GA changes, ship a new tagged image (`v*`) so GitOps rolls a rebuilt frontend.
- Tagged releases fail fast if the GA variable is missing.
- Production frontend emits a non-interaction `ga_health_ping` event once per browser session after GA bootstrap.

Verify what users are actually getting:

```bash
python - <<'PY'
import urllib.request
html = urllib.request.urlopen('https://makeacompany.ai', timeout=15).read().decode('utf-8', 'ignore')
print('googletagmanager.com/gtag/js?id=G-29N1GMQ3NE' in html)
PY
```

For immediate DebugView validation, open:

`https://makeacompany.ai/?ga_debug=1`

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
- Create a **`makeacompany-ai-runtime-secrets`** Secret (or SealedSecret) with the Stripe keys in the env table (at minimum one API secret, webhook signing secrets, and both waitlist price ids) — referenced by the backend Deployment (`envFrom`).

## Docs

- [docs/redis-operations.md](docs/redis-operations.md)

## License

Proprietary — BimRoss.

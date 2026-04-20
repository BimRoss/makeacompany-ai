# makeacompany.ai

Source: [github.com/BimRoss/makeacompany-ai](https://github.com/BimRoss/makeacompany-ai)

Marketing landing page and **$1 Stripe waitlist** for [makeacompany.ai](https://makeacompany.ai), with a Go API and Redis persistence. Stack mirrors BimRoss patterns (Thread Pilot–style billing hooks, Subnet Signal–style Redis backups in GitOps).

## Repo layout

- `docs/redis-operations.md` — Redis keys, prod gut vs sacred waitlist data
- `docs/prod-company-channels-env-checklist.md` — env checklist for Slack-first company registry + optional [`scripts/company-channels-discover-from-orchestrator.mjs`](scripts/company-channels-discover-from-orchestrator.mjs)
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

Sync team data into this repo (Slack manifests from **slack-factory** + capability assignments from **slack-orchestrator**):

```bash
ORCHESTRATOR_URL=http://127.0.0.1:8080 ORCHESTRATOR_DEBUG_TOKEN=… npm run sync:team
```

Or offline: `(cd ../slack-orchestrator && go run ./cmd/catalog-export) > /tmp/catalog.json` then `CATALOG_JSON_PATH=/tmp/catalog.json npm run sync:team`.

Generated fallback files:

- `src/data/admin/team-snapshot.json`

Admin surface (orchestrator + NATS are the live contract for Slack bots; catalog Redis is for `/employees` / admin APIs and may stay read-only):

- Route: `/admin`
- Proxy endpoint: `GET/PUT /api/admin/catalog` -> backend `GET/PUT /v1/admin/catalog`
- `PUT` may include `X-Admin-Token` for machine clients when `ADMIN_CATALOG_TOKEN` is set; the admin UI relies on the session cookie only.
- Sign-in route: `/admin/login` starts Stripe-backed verification before issuing an HttpOnly admin session cookie.
- Includes an 8-panel service overview Grafana grid (4 columns x 2 rows) for high-level runtime monitoring.
- Bottom of the page: read-only **Slack channels (Redis)** strip — loads the shared company-channel registry (`employee-factory:company_channels` by default) via `GET /api/admin/company-channels` and shows per-channel metadata as pills. **Slack + discover** repopulates that HASH; see [docs/redis-operations.md](docs/redis-operations.md) for prod reset vs sacred waitlist keys.
- **Source of truth (Slack):** **slack-orchestrator** ships capability JSON on dispatch → NATS → **employee-factory** (runtime gates and skill routing).
- **Admin `/skills` / `/employees`:** Set **`SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL`** on the **makeacompany-ai backend** to the orchestrator `GET /debug/capability-catalog` URL (and **`SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_TOKEN`** when debug auth requires Bearer). Then **`GET /v1/runtime/capability-catalog`** proxies that JSON on **every request** — no Redis drift for the Skills cards. If unset, the backend serves **Redis** `makeacompany:catalog:capabilities:v1` merged with code defaults (can drift until you sync). `/admin` catalog editing stays read-only.
- **Read vs create in Slack:** `read-*` skills (for example read Slack, read Twitter) execute immediately; `create-*` skills keep confirm-before-run behavior (Joanne email/docs/Slack channel creates, and similar).
- Backend derives `runtimeTool` from `<employee>-<skill-id>` and migrates legacy values on catalog reads/writes.
- Optional `revision` / `source` fields are for operator traceability (not tied to CI).

**Bootstrap / seed Redis** from **slack-orchestrator** (`GET /debug/capability-catalog`, same JSON as NATS `Capabilities`) using **kubectl** (does not use the admin HTTP API for seeding):

```bash
ORCHESTRATOR_URL=http://127.0.0.1:8080 ORCHESTRATOR_DEBUG_TOKEN=… ./scripts/seed-capability-catalog-redis-kubectl.sh
```

Requires `kubectl` against the **admin** cluster and `deploy/makeacompany-ai-redis` in namespace `makeacompany-ai`. See [docs/redis-operations.md](docs/redis-operations.md).

Alternative (calls `PUT /v1/admin/catalog`): `scripts/sync-capability-catalog-from-orchestrator.mjs` — requires `CATALOG_SYNC_BASE_URL`, admin token, and orchestrator reachability. There is **no** scheduled GitHub Action for catalog sync.

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
- API: http://localhost:8090 (host port **8090** so **8080** stays free for [slack-orchestrator](https://github.com/BimRoss/slack-orchestrator) in another terminal; bundled Redis publishes on host **6380** so **6379** stays free for [employee-factory](https://github.com/BimRoss/employee-factory) NATS/Redis).  
- **`/admin` orchestrator log:** with slack-orchestrator running locally and published on `${SLACK_ORCHESTRATOR_PORT:-8080}`, compose sets `ORCHESTRATOR_DEBUG_BASE_URL` to `http://host.docker.internal` on that port. If you change `ORCHESTRATOR_PORT` in the orchestrator compose file, set the same value as `SLACK_ORCHESTRATOR_PORT` in `.env` here.  
- **Shared employee-factory Redis (`COMPANY_CHANNELS_REDIS_URL`):** the compose backend’s primary `REDIS_URL` targets the **bundled** Redis (host **6380**), which does not contain `employee-factory:*` keys. employee-factory writes `employee-factory:company_channels` and `employee-factory:channel_knowledge:{id}:markdown` on **host :6379**. Set `COMPANY_CHANNELS_REDIS_URL=redis://host.docker.internal:6379/0` in `.env` so `/admin` channel pills and per-channel **Transcript** (digest) match the bots.  
- **Compose-only overrides:** `COMPOSE_PUBLIC_API_URL` (default `http://localhost:8090`) is what the **browser** uses for the API from the Next container; `COMPOSE_REDIS_URL` is what the **backend container** uses, so a host-oriented `REDIS_URL` in `.env` for `go run` does not break Docker.
- **Grafana embeds on `/admin`:** with `Host: localhost`, the app does **not** default to production Grafana anymore. To show charts against a cluster or local forward, set `HEALTH_GRAFANA_AGENTS_DASHBOARD_URL` (and related `HEALTH_GRAFANA_*` vars) to your Grafana base URL.

```bash
# Frontend dev server + admin-cluster backend via compose-managed kubectl port-forward
docker compose --profile prod up --build
```

- Site: http://localhost:3000
- Prod backend forward: http://localhost:18080
- **Slack orchestrator** for `/admin` orchestrator log: compose runs `k8s-orchestrator-forward` (kubectl port-forward to `svc/slack-orchestrator` in namespace `slack-orchestrator`). The Next container uses `ORCHESTRATOR_DEBUG_BASE_URL=http://k8s-orchestrator-forward:8080` by default. Optional `ORCHESTRATOR_DEBUG_TOKEN` only if you lock down `GET /debug/decisions` with a bearer on the orchestrator.
- Required env for this profile: `KUBECONFIG_HOST_PATH` (for example `/Users/grant/.kube/config/admin.yaml`)
- `frontend-prod` waits for the backend and orchestrator port-forward services to report healthy before startup.

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
| `ADMIN_CATALOG_TOKEN` | Optional machine token: `PUT /v1/admin/catalog` with matching `X-Admin-Token` (no browser session). Admin UI uses session cookie only; writes still land in Redis. |
| `CAPABILITY_CATALOG_READ_TOKEN` | Optional bearer token required for backend `GET /v1/runtime/capability-catalog` (runtime consumer reads) |
| `ADMIN_ALLOWED_EMAIL` | Required email allowed to establish `/admin` session after Stripe auth completes |
| `ADMIN_SESSION_TTL_SEC` | Admin session lifetime in seconds (default `259200`) |
| `APP_BASE_URL` | Public site URL (Stripe success/cancel) |
| `BACKEND_INTERNAL_API_BASE_URL` | Server-side internal backend base for Next route handlers (defaults to localhost locally and service DNS in Kubernetes) |
| `BACKEND_INTERNAL_SERVICE_TOKEN` | Same secret on Next + Go: Bearer for admin read APIs and `POST /v1/admin/company-channels/discover` (set in prod; see [docs/prod-company-channels-env-checklist.md](docs/prod-company-channels-env-checklist.md)) |
| `COMPANY_CHANNELS_REDIS_URL` | Optional: Redis URL for `employee-factory:*` keys (defaults to `REDIS_URL`). See [docs/redis-operations.md](docs/redis-operations.md#key-prefix-matrix-quick-reference). |
| `KUBECONFIG_HOST_PATH` | Local kubeconfig path mounted into compose `k8s-*` port-forward services (used by `--profile prod`) |
| `KUBECONFIG_CONTEXT` | Kubernetes context for compose `k8s-*` forwards (defaults to `admin`) |
| `PROD_BACKEND_PORT` | Host port for forwarded `makeacompany-ai-backend` service (defaults to `18080`) |
| `ORCHESTRATOR_DEBUG_BASE_URL` | Base URL for slack-orchestrator `GET /debug/decisions` (Next.js API proxies here). **`docker compose --profile prod`** defaults to `http://k8s-orchestrator-forward:8080` (in-compose kubectl forward to prod). For plain `npm run dev` on the host, use e.g. `http://127.0.0.1:18081` after manual `kubectl port-forward`. |
| `ORCHESTRATOR_DEBUG_TOKEN` | Optional server-only bearer sent to slack-orchestrator when set (lock down `GET /debug/*`). Must match orchestrator `ORCHESTRATOR_DEBUG_TOKEN` when `ORCHESTRATOR_DEBUG_ALLOW_ANON=false`. |
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
| `HEALTH_GRAFANA_DASHBOARD_URL` | MakeACompany **Observability** dashboard URL for the `/admin` eight-panel overview grid (via `HEALTH_GRAFANA_ADMIN_*`) |
| `HEALTH_GRAFANA_ADMIN_PANEL_IDS` / `HEALTH_GRAFANA_ADMIN_PANEL_TITLES` | `/admin` panels (defaults align with backend, agents, orchestrator, and error-rate charts — see `.env.example`) |
| `HEALTH_GRAFANA_AGENTS_DASHBOARD_URL` | **Agents** dashboard for `/employees` team-card embeds and `/agents` (uses Grafana `var-employee`) |
| `HEALTH_GRAFANA_AGENTS_PANEL_IDS` / `HEALTH_GRAFANA_AGENTS_PANEL_TITLES` | Panel ids/titles for `/employees` + `/agents` |
| `HEALTH_GRAFANA_SLACK_ORCHESTRATOR_DASHBOARD_URL` | **Slack orchestrator** dashboard for `/slack-orchestrator` |
| `HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_IDS` / `HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_TITLES` | Panel ids/titles for `/slack-orchestrator` |
| `HEALTH_GRAFANA_TWITTER_DASHBOARD_URL` | Twitter dashboard URL — **only** source for `/twitter` Grafana iframes |
| `HEALTH_GRAFANA_TWITTER_PANEL_IDS` / `HEALTH_GRAFANA_TWITTER_PANEL_TITLES` | Twitter panel ids/titles for `/twitter` (no mixed observability panels) |
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
- Capability catalog changes are **not** automated in CI: edit via **`/admin`** (or run the optional bootstrap script above). Catalog updates roll out with normal backend deploys when Redis persistence is shared; no separate sync workflow.

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
| `RANCHER_ADMIN_REPO_TOKEN` | PAT with push access to **`bimross/rancher-admin`** (for `gitops-release` on tag builds) |

`NEXT_PUBLIC_GA_MEASUREMENT_ID` and related build vars live under **Settings → Secrets and variables → Actions → Variables** as documented above.

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

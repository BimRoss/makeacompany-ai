# makeacompany.ai

Source: [github.com/BimRoss/makeacompany-ai](https://github.com/BimRoss/makeacompany-ai)

Marketing landing page and **$1 Stripe waitlist** for [makeacompany.ai](https://makeacompany.ai), with a Go API and Redis persistence. Stack mirrors BimRoss patterns (Thread Pilot–style billing hooks, Subnet Signal–style Redis backups in GitOps).

Sibling **employee-factory** local compose defaults to this repo’s Redis on **`host.docker.internal:${REDIS_PORT:-6380}`** so one DB holds admin snapshots and `employee-factory:*` keys; run **`../employee-factory/scripts/sync-makeacompany-local-from-sibling.sh dev`** there (or **`make sync-makeacompany-bridge`**) to copy **`BACKEND_INTERNAL_SERVICE_TOKEN`** and snapshot POST URLs from this repo’s **`.env.dev`**. Leave **`COMPANY_CHANNELS_REDIS_URL`** unset here when sharing that single Redis.

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
- Sign-in route: `/admin/login` uses Google OAuth and/or Resend magic links (same env keys as the company portal) for allowlisted accounts, then issues an HttpOnly admin session cookie.
- Includes an 8-panel service overview Grafana grid (4 columns x 2 rows) for high-level runtime monitoring.
- Bottom of the page: read-only **Companies** strip — `GET /api/admin/company-channels` reads the shared registry (`employee-factory:company_channels` by default); **`GET /api/admin/slack-member-channels`** serves a **Redis snapshot** (`makeacompany:admin:slack_member_channels_snapshot`) rebuilt by `POST /v1/internal/refresh-slack-member-channels-snapshot` (hourly CronJob in rancher-admin) or, for local compose, `POST /v1/internal/bootstrap-company-channels-from-orchestrator` (snapshot plus registry upsert in one call). Use `?source=live` to hit slack-orchestrator immediately and rewrite Redis. **Discover** in the browser still refines registry rows when you are signed in. See [docs/redis-operations.md](docs/redis-operations.md) for prod reset vs sacred waitlist keys.
- **Source of truth (Slack):** **slack-orchestrator** ships capability JSON on dispatch → NATS → **employee-factory** (runtime gates and skill routing).
- **Admin `/skills` / `/employees`:** Set **`SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL`** on the **makeacompany-ai backend** to the in-cluster orchestrator URL (e.g. `http://slack-orchestrator.<ns>.svc:8080/debug/capability-catalog`) or locally `http://host.docker.internal:8080/debug/capability-catalog`. The backend **GETs without auth** (orchestrator’s default anonymous debug access). Then **`GET /v1/runtime/capability-catalog`** returns that JSON on **every request**. If unset, the backend serves **Redis** merged with code defaults. `/admin` catalog editing stays read-only.
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

**Products and prices** for this app are defined in **[bimross/stripe-factory](https://github.com/BimRoss/stripe-factory)** (Terraform: test vs live). After `terraform apply`, copy the output **`makeacompany_waitlist_price_id`** into **`STRIPE_PRICE_ID_WAITLIST`** in **`.env.dev`** (test) and **`.env.prod`** (live), or into cluster secrets via **`scripts/update-rancher-secrets.sh`**.

- Webhook events: `webhooks/makeacompany-ai.events.txt` in that repo.
- Local webhooks: Stripe CLI — see **`stripe-factory` → `docs/LOCAL.md`**.

## Local development

Copy `.env.example` to **`.env.dev`** (gitignored), set Stripe **test** keys and **`STRIPE_PRICE_ID_WAITLIST`**. **`docker compose --profile local`** loads **`${MAKEACOMPANY_AI_ENV_FILE:-.env.dev}`** into **`backend`** / **`frontend-local`** (same pattern as slack-orchestrator’s **`SLACK_ORCHESTRATOR_ENV_FILE`**). **`frontend-prod`** uses **`${MAKEACOMPANY_AI_ENV_FILE:-.env.prod}`** when unset so prod profile lines up with **`.env.prod`** without an extra export. For host **`npm run dev`** / **`go run`**, many tools only read **`./.env`**: run **`./scripts/use-env.sh dev`** to symlink **`.env` → `.env.dev`**. Production-only values live in **`.env.prod`**; use that file with **`./scripts/update-rancher-secrets.sh`** to push runtime secrets to the admin cluster—do not symlink prod for day-to-day dev. Prod-like compose: **`npm run docker:prod -- up --build`** (runs **`docker compose --env-file .env.prod --profile prod …`**, so **`KUBECONFIG_*`** in **`.env.prod`** applies to kubectl forwards and **`frontend-prod`** defaults to **`.env.prod`** when **`MAKEACOMPANY_AI_ENV_FILE`** is unset). Equivalents: **`./scripts/docker-prod-up.sh up --build`**, or **`docker compose --env-file .env.prod --profile prod up --build`** if you prefer not to use the script.

```bash
# Redis + API + Next (hot reload for frontend)
docker compose --profile local up --build
```

Sibling Go repos (**slack-orchestrator**, **employee-factory**) do not use a Go file watcher: their compose dev images compile on each container start—restart a service or run `up --build` after backend changes there.

- Site: http://localhost:3000  
- API: http://localhost:8090 (host port **8090** so **8080** stays free for [slack-orchestrator](https://github.com/BimRoss/slack-orchestrator) in another terminal). Bundled Redis publishes on host **${REDIS_PORT:-6380}**; sibling [employee-factory](https://github.com/BimRoss/employee-factory) local compose defaults workers to **`redis://host.docker.internal:${MAKEACOMPANY_AI_REDIS_PORT:-6380}/0`** so **makeacompany:*** and **employee-factory:*** keys share one DB.  
- **`/admin` orchestrator log:** with slack-orchestrator running locally and published on `${SLACK_ORCHESTRATOR_PORT:-8080}`, compose sets `ORCHESTRATOR_DEBUG_BASE_URL` to `http://host.docker.internal` on that port. If you change `ORCHESTRATOR_PORT` in the orchestrator compose file, set the same value as `SLACK_ORCHESTRATOR_PORT` in **`.env.dev`** (or whatever **`MAKEACOMPANY_AI_ENV_FILE`** points at).  
- **Single Redis (recommended):** leave **`COMPANY_CHANNELS_REDIS_URL`** unset so the backend uses the same bundled Redis for waitlist, admin snapshots, **`makeacompany:user_profile:*`**, and **`employee-factory:*`** (company channels, channel-knowledge, Joanne read-user Stripe field). Set **`REDIS_URL=redis://localhost:6380/0`** in **`.env.dev`** for host **`go run`** / tests so they hit the same host port as compose.  
- **Compose-only overrides:** `COMPOSE_PUBLIC_API_URL` (default `http://localhost:8090`) is what the **browser** uses for the API from the Next container; the backend container’s **`REDIS_URL`** is set in compose to **`${COMPOSE_REDIS_URL:-redis://redis:6379/0}`** (in-network service), so host **`REDIS_URL`** in **`.env.dev`** does not change Docker unless you also set **`COMPOSE_REDIS_URL`**.
- **Grafana embeds on `/admin`:** with `Host: localhost`, the app does **not** default to production Grafana. Set **`HEALTH_GRAFANA_LOCAL_BASE_URL`** to the origin you port-forward (e.g. `http://127.0.0.1:13000`); the server appends the default `/grafana/d/...` paths. Or set full **`HEALTH_GRAFANA_DASHBOARD_URL`** / other `HEALTH_GRAFANA_*` URLs. The **`prod`** compose profile also runs **`k8s-grafana-forward`** and defaults `HEALTH_GRAFANA_LOCAL_BASE_URL` to `http://127.0.0.1:${PROD_GRAFANA_HOST_PORT:-13000}` so the eight-panel grid works without pasting dashboard URLs.

```bash
# Frontend dev server + admin-cluster backend via compose-managed kubectl port-forward
npm run docker:prod -- up --build
```

- Site: http://localhost:3000
- Prod backend forward: http://localhost:18080
- **Grafana** for `/admin` overview iframes: compose runs **`k8s-grafana-forward`** (`kubectl port-forward` to `svc/makeacompany-ai-grafana` in namespace `makeacompany-ai`, published on host **`${PROD_GRAFANA_HOST_PORT:-13000}`**). `frontend-prod` sets **`HEALTH_GRAFANA_LOCAL_BASE_URL`** to match so loopback gets real panel URLs. Override with `HEALTH_GRAFANA_LOCAL_BASE_URL` or `HEALTH_GRAFANA_DASHBOARD_URL` in **`.env.prod`** (or pass a different compose **`--env-file`**) if needed.
- **Slack orchestrator** for `/admin` orchestrator log: compose runs `k8s-orchestrator-forward` (kubectl port-forward to `svc/slack-orchestrator` in namespace `slack-orchestrator`). The Next container uses `ORCHESTRATOR_DEBUG_BASE_URL=http://k8s-orchestrator-forward:8080` by default. Optional `ORCHESTRATOR_DEBUG_TOKEN` only if you lock down `GET /debug/decisions` with a bearer on the orchestrator.
- **`KUBECONFIG_HOST_PATH` / `KUBECONFIG_CONTEXT`:** resolve at compose **parse** time for **`k8s-*`** volume mounts. If unset, compose defaults **`KUBECONFIG_HOST_PATH`** to **`${HOME}/.kube/config/admin.yaml`** (BimRoss); set **`KUBECONFIG_HOST_PATH=/dev/null`** only if you need to parse the file on a host with no kube fragment. **`npm run docker:prod`** still passes **`--env-file .env.prod`** so Stripe keys and optional kube overrides live in one place.
- `frontend-prod` waits for the backend, orchestrator, and Grafana port-forward services to report healthy before startup.

Quick checks if `/employees` data looks wrong:

```bash
npm run docker:prod -- ps
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
| `ADMIN_SESSION_TTL_SEC` | Admin session lifetime in seconds (default `259200`). Admin sign-in allowlist is fixed in code: `grant@bimross.com` only. |
| `APP_BASE_URL` | Public site URL (Stripe success/cancel for waitlist checkout, magic-link links, Google OAuth redirect base) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | **Continue with Google** on `/{channelId}/login` and `/admin/login`. Register **`{APP_BASE_URL}/api/portal/auth/google/callback`** in Google Cloud (admin sign-in reuses this URI; signed `state` selects portal vs admin). Optional legacy URI `{APP_BASE_URL}/api/admin/auth/google/callback` if you still have in-flight OAuth from older deploys. Backend needs the same **client id** as `GOOGLE_OAUTH_CLIENT_ID` to validate `id_token` audiences. |
| `PORTAL_GOOGLE_OAUTH_STATE_SECRET` | Optional (≥16 chars): HMAC secret for OAuth `state` (portal and admin). If omitted, `GOOGLE_OAUTH_CLIENT_SECRET` is used. |
| `RESEND_API_KEY` / `PORTAL_AUTH_EMAIL_FROM` | Optional: portal and admin **email sign-in links**. Set on **Go** (sends mail) and on **Next** (shows the form when both are set). `from` must be verified in Resend. |
| `RESEND_MAGIC_LINK_TEMPLATE_ID` | Optional **Go** only: Resend published template id or slug (e.g. `account-login`). If unset, magic links use simple inline HTML/text. Optional `RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR` / `RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR` default to `login_url` / `recipient_first_name`. |
| `BACKEND_INTERNAL_API_BASE_URL` | Server-side internal backend base for Next route handlers (defaults to localhost locally and service DNS in Kubernetes) |
| `BACKEND_INTERNAL_SERVICE_TOKEN` | Bearer for `/v1/internal/*` (CronJobs, compose one-shots). **Not** Google OAuth. Local compose defaults to `mac-local-dev-internal-service-token` when unset; production must set a real secret. When unset on the backend, internal POSTs also accept a signed-in `/admin` session Bearer. |
| `COMPANY_CHANNELS_REDIS_URL` | Optional: Redis URL for `employee-factory:*` keys (defaults to `REDIS_URL`). See [docs/redis-operations.md](docs/redis-operations.md#key-prefix-matrix-quick-reference). |
| `MAKEACOMPANY_AI_ENV_FILE` | Override path for compose **`env_file`**. When unset: **`--profile local`** services use **`.env.dev`**; **`frontend-prod`** uses **`.env.prod`**. Set explicitly to force one file for both (e.g. **`.env.dev`** while hitting prod k8s forwards). |
| `KUBECONFIG_HOST_PATH` | Host kubeconfig path for **`k8s-*`** forwards; defaults to **`${HOME}/.kube/config/admin.yaml`**. Override in **`.env.prod`** / **`--env-file`** if your fragment lives elsewhere. |
| `KUBECONFIG_CONTEXT` | Kubernetes context for compose `k8s-*` forwards (defaults to `admin`) |
| `PROD_BACKEND_PORT` | Host port for forwarded `makeacompany-ai-backend` service (defaults to `18080`) |
| `ORCHESTRATOR_DEBUG_BASE_URL` | Base URL for slack-orchestrator `GET /debug/decisions` (Next.js API proxies here). **`--profile prod`** defaults to `http://k8s-orchestrator-forward:8080` (in-compose kubectl forward to prod). For plain `npm run dev` on the host, use e.g. `http://127.0.0.1:18081` after manual `kubectl port-forward`. |
| `ORCHESTRATOR_DEBUG_TOKEN` | Optional server-only bearer sent to slack-orchestrator when set (lock down `GET /debug/*`). Must match orchestrator `ORCHESTRATOR_DEBUG_TOKEN` when `ORCHESTRATOR_DEBUG_ALLOW_ANON=false`. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 stream id injected into frontend at build time |
| `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` | LinkedIn Insight Tag partner id; frontend injects LinkedIn tracking only in production when set |
| `STRIPE_SECRET_KEY` | API secret for this environment (`sk_test_…` in **`.env.dev`**, `sk_live_…` in **`.env.prod`**) |
| `STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public key; compose and **`update-rancher-secrets.sh`** set **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** (and `STRIPE_PUBLISHABLE_KEY` in the cluster secret) from either name |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for Stripe webhooks to this backend (`whsec_…`) |
| `STRIPE_PRICE_ID_WAITLIST` | Waitlist Stripe `price_…` id for this file (test in **`.env.dev`**, live in **`.env.prod`**) |
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

**Webhook URL (POST):** `{backend origin}/v1/billing/webhook` — e.g. ngrok `https://YOUR_SUBDOMAIN.ngrok-free.dev/v1/billing/webhook` forwarding to `localhost:8080`. Configure a single endpoint in Stripe Dashboard; use **`STRIPE_WEBHOOK_SECRET`** from that destination.

Checkout and admin Stripe reads use **`STRIPE_PRICE_ID_WAITLIST`** together with **`STRIPE_SECRET_KEY`** for the same environment (test vs live is determined by which **`.env.*`** file you use, not by inferring from the secret prefix).

**`NEXT_PUBLIC_*` in Kubernetes:** GA + site defaults come from ConfigMap **`makeacompany-ai-config`**; Stripe publishable keys come from Secret **`makeacompany-ai-runtime-secrets`** as **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** (and `STRIPE_PUBLISHABLE_KEY`). Client-bundled `NEXT_PUBLIC_*` in a production **Docker** image are fixed at **`npm run build`** unless you add build-args in CI; set publishable keys in the image build when the frontend starts using Stripe.js in the browser. The same build-time rule applies to `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` for LinkedIn Insight in production.

### Admin cluster (runtime Secret)

From a machine with `kubectl` access to the **admin** cluster:

```bash
./scripts/update-rancher-secrets.sh
```

Reads repo-root **`.env.prod`** when present (else **`.env`**) and applies Secret **`makeacompany-ai-runtime-secrets`** in namespace **`makeacompany-ai`**: **`STRIPE_SECRET_KEY`**, **`STRIPE_PRICE_ID_WAITLIST`**, **`STRIPE_WEBHOOK_SECRET`**, plus **`STRIPE_PUBLISHABLE_KEY`** / **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** when set, optional **`BACKEND_INTERNAL_SERVICE_TOKEN`** (for `/v1/internal/*` jobs), **`SLACK_BOT_TOKEN`**, **`COOKIE_HEALTH_TOKEN`**, and optional portal login keys (**`GOOGLE_OAUTH_CLIENT_ID`**, **`GOOGLE_OAUTH_CLIENT_SECRET`**, **`PORTAL_GOOGLE_OAUTH_STATE_SECRET`**, **`RESEND_API_KEY`**, **`PORTAL_AUTH_EMAIL_FROM`**). Keys omitted from `.env.prod` but already on the cluster are **preserved** so Stripe-only edits do not drop Google/Resend. Catalog price ids often originate in **[stripe-factory](https://github.com/BimRoss/stripe-factory)**. Prefer **`makeacompany-ai/scripts/update-rancher-secrets.sh`** with a full **`.env.prod`**; the narrower **`stripe-factory/scripts/update-rancher-secrets.sh`** omits admin and portal keys—see that script’s header.

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
- Create a **`makeacompany-ai-runtime-secrets`** Secret (or SealedSecret) with the Stripe keys in the env table (at minimum API secret, webhook signing secret, and waitlist price id) — referenced by the backend Deployment (`envFrom`).

## Docs

- [docs/redis-operations.md](docs/redis-operations.md)

## License

Proprietary — BimRoss.

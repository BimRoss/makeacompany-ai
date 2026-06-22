# CASA Readiness — Personal-Agent Google Integration

Prep doc for the Cloud Application Security Assessment (App Defense Alliance / CASA) required for
Google restricted-scope verification. CASA is mandatory for us because the agent accesses Google
data **through our own servers** (the in-pod token sidecar). Pair with
`google-workspace-data-handling.md`. Owner: engineering. Last updated: 2026-06-22.

## 1. What CASA is (for budgeting)
- Framework: App Defense Alliance, based on **OWASP ASVS**. **Tier 2** is expected for our profile
  ("Self Scan – Lab Verified" — we run the scan, an ADA-authorized lab verifies and issues the
  Letter of Assessment). Tier 3 (full pentest) is for higher-risk apps.
- **Valid 12 months**; annual re-assessment required to retain restricted-scope access.
- **Open items to confirm with a lab** (not settled by research): exact Tier (2 vs 3), price
  (typically ~$1–5k for Tier 2), SAQ contents, and whether third-party-server access forces a
  lab-led scan vs. self-scan. Get quotes from ADA-authorized labs (e.g. via appdefensealliance.dev)
  before committing a timeline.

## 2. Data-flow (assessment scope)
```
user (browser, /me)
  └─ GET /api/me/connections/google/start  → discovery + DCR register (gateway) → 302 /authorize
       └─ gateway /consent → Google → gateway /oauth2callback → 302 /api/.../callback?code
            └─ backend /v1/me/personal-agents/google/connect/finish
                 ├─ writes per-user Secret gws-oauth-<hash> (client_id/secret/refresh_token)
                 ├─ creates per-user SA + Role(get,patch on that Secret) + RoleBinding
                 └─ rolls the PA pod
  PA pod (personal-agents ns):
    ├─ personal-agent container (the agent runtime; talks to Claude)
    └─ gws-mcp-token-sidecar: reads Secret → mints 1h access tokens at the gateway →
         serves localhost:8081/mcp → agent's mcp__google-workspace__* tools → Google APIs
  gateway (google-workspace-mcp-gateway-pa ns): OAuth 2.1 proxy; DCR registry on encrypted
    hostPath PV; upstream client in the makeacompany-workspace GCP project.
```
**In-scope components for the assessment:** the Next.js connect routes, the Go backend
connect/disconnect/status + credential writer, the personal-agent runtime, the token sidecar, the
gateway, and the Kubernetes secret/RBAC/network surface.

## 3. Controls already in place (map to ASVS)
- **Credential isolation** — refresh token in a per-user Secret; per-user ServiceAccount + Role
  scoped to exactly that one Secret (no cross-tenant secret access).
- **Token lifecycle** — short-lived (1h) access tokens, refresh rotated on every mint, revoked +
  Secret deleted on disconnect/deprovision.
- **Network** — default-deny NetworkPolicies; gateway reachable only from the personal-agents ns;
  egress allow-listed; `/mcp` not internet-exposed.
- **Transport** — TLS on all ingress; cert-manager-issued certs.
- **Least privilege** — minimum scopes; sidecar SA limited to get/patch on its own Secret.
- **Tenant isolation** — one agent per owner; identity bound server-side at the gateway.

## 4. Likely gaps to remediate / document before assessment
- [ ] **Secrets-at-rest encryption** — confirm/enable etcd encryption-at-rest (or KMS) for K8s
      Secrets; document it. (Today secrets are base64 in etcd unless encryption-at-rest is on.)
- [ ] **Dependency / CVE scanning** — ensure image + dependency scanning (e.g. in CI) with a
      documented patch cadence; have results ready for the SAQ.
- [ ] **Access logging & audit** — document who can access the cluster/secrets and how access is
      logged; tie to the "no human reads user data" policy.
- [ ] **Data-flow + retention doc** — this file + `google-workspace-data-handling.md` satisfy most
      of it; keep current.
- [ ] **Vuln management / disclosure** — a security contact + basic vuln-handling process.
- [ ] **Branch protection / SDLC** — note CI checks, review requirements (and the `--admin` merge
      exception used during this build-out).

## 5. Sequencing
Brand verification (Gate 1) and sensitive-scope verification (Gate 2) do **not** require CASA and
can proceed immediately. Only restricted scopes (Gmail, full Drive) trigger CASA. If we narrow to
`drive.file` and defer/drop Gmail, CASA is not needed at all (all-sensitive set → verification
only). Decision tracked in issue #648.

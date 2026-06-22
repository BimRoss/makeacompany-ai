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

## 3. Controls already in place (map to ASVS) — audited 2026-06-22
- **Secrets at rest: ENCRYPTED** ✓ — kube-apiserver runs with
  `--encryption-provider-config=/var/lib/rancher/rke2/server/cred/encryption-config.json` +
  `--encryption-provider-config-automatic-reload=true` (RKE2 secrets-encryption on). K8s Secrets
  are encrypted in etcd, not base64-only.
- **Data store transport: TLS** ✓ — etcd over TLS (apiserver `--etcd-cafile/-certfile/-keyfile`).
- **Credential isolation** ✓ — refresh token in a per-user Secret; per-user ServiceAccount + Role
  scoped to exactly that one Secret (no cross-tenant secret access).
- **Token lifecycle** ✓ — short-lived (1h) access tokens, refresh rotated on every mint, revoked +
  Secret deleted on disconnect/deprovision.
- **Network** ✓ — default-deny NetworkPolicies; gateway reachable only from the personal-agents ns;
  egress allow-listed; `/mcp` not internet-exposed.
- **Transport (app)** ✓ — TLS on all ingress; cert-manager-issued certs.
- **Static analysis** ✓ — CodeQL active on makeacompany-ai + claude-code-personal-agent.
- **Secret scanning** ✓ — rancher-admin `secret-scan.yml` + GitHub org secret scanning.
- **Least privilege** ✓ — minimum scopes; sidecar SA limited to get/patch on its own Secret.
- **Tenant isolation** ✓ — one agent per owner; identity bound server-side at the gateway.

## 4. Gaps to remediate / document before assessment — audited 2026-06-22
- [ ] **Container/image CVE scanning** — NONE today (no Trivy/Grype on the makeacompany-ai
      backend/frontend, claude-code-personal-agent, or google-workspace-mcp images). Add a scan step
      to the image-build workflows + a patch cadence. **Highest-priority gap.**
- [ ] **Broaden dependency scanning** — Dependabot is on makeacompany-ai only; add to
      claude-code-personal-agent + google-workspace-mcp (the latter pins upstream by SHA → set a
      CVE-driven bump cadence).
- [ ] **K8s API audit logging** — NOT configured (no `--audit-log-path`/`--audit-policy-file`).
      Enable an RKE2 audit policy + retention so cluster/secret access is logged; ties to the "no
      human reads user data" attestation.
- [x] **Secrets-at-rest encryption** — CONFIRMED enabled (see §3). No action.
- [ ] **Access logging & access-control doc** — document who can access the cluster/secrets (depends
      on the audit-logging item).
- [ ] **Data-flow + retention doc** — this file + `google-workspace-data-handling.md` cover it.
- [ ] **Vuln management / disclosure** — publish a security contact + basic vuln-handling process.
- [ ] **Branch protection / SDLC** — note CI checks + review requirements (and re-tighten the
      `--admin` merge exception used heavily during this build-out for steady state).

## 5. Sequencing
Brand verification (Gate 1) and sensitive-scope verification (Gate 2) do **not** require CASA and
can proceed immediately. Only restricted scopes (Gmail, full Drive) trigger CASA. If we narrow to
`drive.file` and defer/drop Gmail, CASA is not needed at all (all-sensitive set → verification
only). Decision tracked in issue #648.

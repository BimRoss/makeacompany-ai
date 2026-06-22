# Google Workspace Data Handling & Limited Use Policy

Internal policy + attestation basis for MakeaCompany's personal-agent Google Workspace
integration. Underpins the privacy-policy disclosure, the OAuth verification submission, and
the CASA self-assessment. Owner: engineering. Last updated: 2026-06-22.

## 1. Scope of this policy
Covers all Google user data accessed when a user connects their Google account to their
personal agent. Data is accessed per-user, under the OAuth scopes that user grants, solely to
execute actions the user invokes through their agent (in Slack / on makeacompany.ai).

## 2. Data accessed
Per the scopes the user authorizes — currently: Gmail (`gmail.modify`, `gmail.send`),
Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts, Forms, Chat, plus identity
(`openid`/`email`/`profile`). No scope is requested that is not used by an agent capability.

## 3. Limited Use commitments (Google API Services User Data Policy)
Google Workspace data:
1. **Purpose limitation** — used only to provide/improve the user-facing agent features the
   user invokes; never for unrelated purposes.
2. **No sale; restricted transfer** — never sold; transferred only to provide those features,
   to comply with law, or in a merger/acquisition with comparable protections.
3. **No advertising** — never used for ads, retargeting, or personalized advertising; never for
   credit/lending.
4. **No generalized AI/ML training** — **never used to create, train, or improve any
   generalized or cross-user AI/ML model.** A user's Workspace data may only inform that same
   user's agent responses. We do not pool one user's Gmail/Drive/etc. content into shared model
   improvement, fine-tuning, or evaluation across the customer base.
5. **No human access** — no employee or contractor reads a user's Workspace content, except:
   (a) with the user's affirmative consent for the specific items; (b) where necessary for
   security (e.g. abuse investigation); (c) to comply with applicable law; or (d) where the data
   is aggregated/anonymized for internal operations. **Debugging on raw user Workspace content is
   prohibited without one of these bases** — engineers reproduce issues with their own connected
   test accounts.

## 4. How data flows & is stored
- Consent: user-driven OAuth 2.1 + PKCE + dynamic client registration via the MakeaCompany
  gateway (`google-mcp-pa.makeacompany.ai`). The user's refresh token is bound to *their* Google
  identity.
- At rest: the refresh token lives in a **per-user Kubernetes Secret** (`gws-oauth-<hash>`) in the
  `personal-agents` namespace, readable/patchable only by that user's dedicated ServiceAccount
  (Role scoped to exactly that one Secret). Rotated on every mint.
- In use: a per-pod sidecar mints short-lived (1h) access tokens on demand; access tokens are not
  persisted. Identity is bound server-side to the user's OAuth client — one agent cannot act as
  another user.
- In transit: TLS throughout (ingress, gateway, Google).
- We do **not** maintain a bulk store of users' Workspace content; content transits the agent to
  fulfill a request and appears in operational logs only as needed for reliability/abuse.

## 5. Retention & deletion
- Disconnecting Google (account page) deletes the per-user Secret + its RBAC and best-effort
  revokes the token at Google.
- Personal-agent deprovisioning removes the agent's namespace resources, including any Google
  credentials.
- Users may also revoke at https://myaccount.google.com/permissions.

## 6. Sub-processors (Google data may transit)
- Anthropic (Claude) — the model that powers the agent; receives only the content needed for the
  invoked action; under Anthropic's API terms (no training on API data).
- Self-hosted gateway + agent infrastructure (our Kubernetes cluster).
- No other third party receives Google Workspace data.

## 7. Security controls (summary; see casa-readiness.md)
Per-user credential isolation + scoped RBAC; token rotation + revoke-on-disconnect; default-deny
network policies; TLS; least-privilege scopes. Pre-assessment remediation tracked in
`casa-readiness.md`.

## 8. Review
Re-reviewed on any scope change and at least annually (aligned with the CASA 12-month
re-assessment cycle).

/**
 * PUT capability catalog from slack-orchestrator into makeacompany-ai backend Redis (admin API).
 * Fetches GET {ORCHESTRATOR_URL}/debug/capability-catalog (same JSON as NATS Capabilities).
 *
 * Env:
 *   ORCHESTRATOR_URL — base URL, default http://127.0.0.1:8080
 *   ORCHESTRATOR_CAPABILITY_CATALOG_URL — optional full URL override
 *   ORCHESTRATOR_DEBUG_TOKEN — Bearer token when orchestrator has ORCHESTRATOR_DEBUG_ALLOW_ANON=false
 *   CATALOG_SYNC_BASE_URL — makeacompany-ai backend (required)
 *   CATALOG_SYNC_WRITE_TOKEN | ADMIN_CATALOG_TOKEN — X-Admin-Token
 *   SOURCE_REVISION — git sha or label for revision field
 *   CAPABILITY_CATALOG_READ_TOKEN — optional, for GET /v1/runtime/capability-catalog verification
 */
function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requireAnyEnv(names) {
  for (const name of names) {
    const value = (process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required env var (expected one of: ${names.join(", ")})`);
}

function optionalEnv(name) {
  return (process.env[name] || "").trim();
}

async function fetchOrchestratorCatalog() {
  const base = optionalEnv("ORCHESTRATOR_URL") || "http://127.0.0.1:8080";
  const normalized = base.replace(/\/$/, "");
  const url = optionalEnv("ORCHESTRATOR_CAPABILITY_CATALOG_URL") || `${normalized}/debug/capability-catalog`;
  const headers = {};
  const tok = optionalEnv("ORCHESTRATOR_DEBUG_TOKEN");
  if (tok) {
    headers.Authorization = `Bearer ${tok}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} failed: ${res.status} ${text}`);
  }
  return await res.json();
}

function normalizeBaseURL(base) {
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const backendBaseURL = normalizeBaseURL(requireEnv("CATALOG_SYNC_BASE_URL"));
  const adminToken = requireAnyEnv(["CATALOG_SYNC_WRITE_TOKEN", "ADMIN_CATALOG_TOKEN", "RANCHER_ADMIN_REPO_TOKEN"]);
  const sourceRevision = requireEnv("SOURCE_REVISION");
  const sourceRepository = optionalEnv("SOURCE_REPOSITORY") || "bimross/slack-orchestrator";
  const sourceRef = optionalEnv("SOURCE_REF") || sourceRevision;
  const runtimeReadToken = optionalEnv("CAPABILITY_CATALOG_READ_TOKEN");

  const sourceCatalog = await fetchOrchestratorCatalog();
  if (!Array.isArray(sourceCatalog.coreEmployees) || !Array.isArray(sourceCatalog.skills)) {
    throw new Error("orchestrator catalog invalid: expected coreEmployees, skills");
  }

  const payload = {
    ...sourceCatalog,
    revision: sourceRevision,
    source: `${sourceRepository}@${sourceRef}`,
  };

  const putURL = `${backendBaseURL}/v1/admin/catalog`;
  const putBody = await requestJSON(putURL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": adminToken,
      "X-Capability-Catalog-Revision": sourceRevision,
    },
    body: JSON.stringify(payload),
  });

  if ((putBody.revision || "").trim() !== sourceRevision) {
    throw new Error(`catalog PUT revision mismatch: expected ${sourceRevision}, got ${putBody.revision || "<empty>"}`);
  }

  const getHeaders = {};
  if (runtimeReadToken) {
    getHeaders.Authorization = `Bearer ${runtimeReadToken}`;
  }
  const runtimeURL = `${backendBaseURL}/v1/runtime/capability-catalog`;
  const runtimeBody = await requestJSON(runtimeURL, {
    method: "GET",
    headers: getHeaders,
  });

  if ((runtimeBody.revision || "").trim() !== sourceRevision) {
    throw new Error(`runtime catalog revision mismatch: expected ${sourceRevision}, got ${runtimeBody.revision || "<empty>"}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        revision: sourceRevision,
        source: payload.source,
        runtimeRevision: runtimeBody.revision,
        updatedAt: runtimeBody.updatedAt || null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("catalog sync failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

/**
 * Optional: PUT skills-catalog.json to /v1/admin/catalog (requires CATALOG_SYNC_BASE_URL + admin token).
 * Prefer seeding Redis with ./scripts/seed-capability-catalog-redis-kubectl.sh — admin API stays reserved for
 * the /admin UI and Stripe OAuth; ops seeding should not depend on it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

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
  const value = (process.env[name] || "").trim();
  return value || "";
}

async function readCatalogFromDisk(catalogPath) {
  const raw = await readFile(catalogPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.coreEmployees) || !Array.isArray(parsed.skills) || typeof parsed.employeeSkillIds !== "object") {
    throw new Error("skills-catalog.json shape invalid: expected coreEmployees, skills, employeeSkillIds");
  }
  return parsed;
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
  const sourceRepository = optionalEnv("SOURCE_REPOSITORY") || "bimross/slack-factory";
  const sourceRef = optionalEnv("SOURCE_REF") || sourceRevision;
  const runtimeReadToken = optionalEnv("CAPABILITY_CATALOG_READ_TOKEN");

  const defaultCatalogPath = path.resolve(process.cwd(), "slack-factory", "skills-catalog.json");
  const catalogPath = path.resolve(optionalEnv("SLACK_FACTORY_CATALOG_PATH") || defaultCatalogPath);
  const sourceCatalog = await readCatalogFromDisk(catalogPath);

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

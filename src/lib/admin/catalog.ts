// /employees, /skills, and admin use getAdminCatalogData() (tries in order, first success wins):
// 1) GET /v1/public/capability-catalog — unauthenticated, for the public site (/skills) and anywhere else that should not need tokens
// 2) GET /v1/runtime/capability-catalog (Bearer when CAPABILITY_CATALOG_READ_TOKEN is set; used by jobs or when public is down)
// 3) GET /v1/admin/catalog with the admin session cookie — e.g. admin UI when 1–2 are unavailable
//
// There is no silent JSON snapshot fallback: if all fail, the UI shows a clear error.
// Backend: when SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL is set, Redis can seed; see backend catalog store.
import { resolveBackendBaseURL, backendProxyAuthHeaders } from "@/lib/backend-proxy-auth";

export type TeamStatus = "active" | "inactive";

export type TeamLane =
  | "automation"
  | "sales"
  | "strategy"
  | "operations"
  | "internship"
  | "general";

export type TeamMember = {
  id: string;
  displayName: string;
  botDisplayName: string;
  lane: TeamLane;
  roleTitle: string;
  shortDescription: string;
  longDescription: string;
  backgroundColor: string;
  status: TeamStatus;
  sourceManifest: string;
  skillIds: string[];
};

export type AdminSkill = {
  id: string;
  label: string;
  description: string;
  employeeIds: string[];
  requiredParams?: string[];
  optionalParams?: string[];
  /** Display-only: default values documented for optional params (e.g. create-email). */
  paramDefaults?: Record<string, string>;
  comingSoon?: boolean;
};

export type CapabilityCatalogEmployee = {
  id: string;
  label: string;
  description: string;
};

export type CapabilityCatalogSkill = {
  id: string;
  label: string;
  description: string;
  runtimeTool: string;
  requiredParams: string[];
  optionalParams: string[];
  paramDefaults?: Record<string, string>;
};

export type CapabilityCatalog = {
  coreEmployees: CapabilityCatalogEmployee[];
  skills: CapabilityCatalogSkill[];
  employeeSkillIds: Record<string, string[]>;
  updatedAt?: string;
  source?: string;
};

export type AdminCatalogLoadAttempt = {
  label: string;
  path: string;
  status?: number;
  detail?: string;
};

export type AdminCatalogLoadError = {
  message: string;
  hint: string;
  attempts: AdminCatalogLoadAttempt[];
};

export type AdminCatalogDataResult =
  | { ok: true; source: "public" | "runtime" | "admin"; members: TeamMember[]; skills: AdminSkill[] }
  | { ok: false; members: []; skills: []; error: AdminCatalogLoadError };

/** Lowercase kebab-case id from a display name (labels, titles). */
export function deriveCatalogIdFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roleForEmployee(id: string): Pick<TeamMember, "lane" | "roleTitle"> {
  switch (id) {
    case "alex":
      return { lane: "sales", roleTitle: "Head of Sales" };
    case "tim":
      return { lane: "strategy", roleTitle: "Head of Simplifying" };
    case "ross":
      return { lane: "automation", roleTitle: "Head of Automation" };
    case "garth":
      return { lane: "internship", roleTitle: "Head of Interns" };
    case "joanne":
      return { lane: "operations", roleTitle: "Head of Executive Operations" };
    default:
      return { lane: "general", roleTitle: "AI Employee" };
  }
}

function memberSort(
  a: TeamMember,
  b: TeamMember,
  preferredOrder: string[] = []
): number {
  const ai = preferredOrder.indexOf(a.id);
  const bi = preferredOrder.indexOf(b.id);
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.displayName.localeCompare(b.displayName);
}

function normalizeCatalogToAdminData(catalog: CapabilityCatalog): {
  members: TeamMember[];
  skills: AdminSkill[];
} {
  const preferredOrder = catalog.coreEmployees
    .map((employee) => String(employee.id || "").trim().toLowerCase())
    .filter(Boolean);
  const members: TeamMember[] = catalog.coreEmployees.map((employee) => {
    const employeeID = String(employee.id || "").trim().toLowerCase();
    const role = roleForEmployee(employeeID);
    const skillIds = Array.isArray(catalog.employeeSkillIds?.[employeeID])
      ? [...new Set(catalog.employeeSkillIds[employeeID].map((id) => String(id).trim()).filter(Boolean))]
      : [];
    return {
      id: employeeID,
      displayName: String(employee.label || employeeID),
      botDisplayName: String(employee.label || employeeID),
      lane: role.lane,
      roleTitle: role.roleTitle,
      shortDescription: String(employee.description || "AI teammate"),
      longDescription: String(employee.description || "AI teammate configured from capability catalog."),
      backgroundColor: "#000000",
      status: "active" as const,
      sourceManifest: "redis:makeacompany:catalog",
      skillIds,
    };
  });
  members.sort((a, b) => {
    const skillCountDiff = b.skillIds.length - a.skillIds.length;
    if (skillCountDiff !== 0) return skillCountDiff;
    return memberSort(a, b, preferredOrder);
  });

  const employeeIdsBySkill = new Map<string, string[]>();
  for (const member of members) {
    for (const skillID of member.skillIds) {
      const current = employeeIdsBySkill.get(skillID) ?? [];
      current.push(member.id);
      employeeIdsBySkill.set(skillID, current);
    }
  }

  const skills: AdminSkill[] = (catalog.skills ?? []).map((skill) => {
    const rawDefaults = skill.paramDefaults;
    const paramDefaults =
      rawDefaults && typeof rawDefaults === "object" && !Array.isArray(rawDefaults)
        ? Object.fromEntries(
            Object.entries(rawDefaults).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()]),
          )
        : undefined;
    return {
      id: String(skill.id || "").trim(),
      label: String(skill.label || skill.id || "").trim(),
      description: String(skill.description || "").trim(),
      employeeIds: employeeIdsBySkill.get(String(skill.id || "").trim()) ?? [],
      requiredParams: Array.isArray(skill.requiredParams) ? [...skill.requiredParams] : [],
      optionalParams: Array.isArray(skill.optionalParams) ? [...skill.optionalParams] : [],
      ...(paramDefaults && Object.keys(paramDefaults).length > 0 ? { paramDefaults } : {}),
    };
  });

  return { members, skills };
}

function firstLine(text: string, max: number): string {
  const line = String(text).trim().split(/\r?\n/)[0] ?? "";
  if (line.length <= max) return line;
  return line.slice(0, max) + "…";
}

type ParsedCatalog =
  | { ok: true; data: CapabilityCatalog }
  | { ok: false; detail: string };

function parseCapabilityCatalogJson(text: string, httpStatus: number): ParsedCatalog {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, detail: `Response was not valid JSON (HTTP ${httpStatus}).` };
  }
  const c = payload as Partial<CapabilityCatalog>;
  if (!Array.isArray(c.coreEmployees) || !Array.isArray(c.skills)) {
    return {
      ok: false,
      detail: `JSON missing coreEmployees or skills array (HTTP ${httpStatus}).`,
    };
  }
  return { ok: true, data: c as CapabilityCatalog };
}

async function fetchCatalogFromBackend(
  base: string,
  path: string,
  label: string,
  headers: HeadersInit | undefined
): Promise<{ attempt: AdminCatalogLoadAttempt; catalog?: CapabilityCatalog }> {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers,
    });
    const text = await response.text();
    const detail = !response.ok ? firstLine(text, 500) : undefined;
    const attempt: AdminCatalogLoadAttempt = {
      label,
      path,
      status: response.status,
      detail,
    };
    if (!response.ok) {
      return { attempt };
    }
    const parsed = parseCapabilityCatalogJson(text, response.status);
    if (!parsed.ok) {
      return { attempt: { ...attempt, detail: parsed.detail } };
    }
    return { attempt, catalog: parsed.data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      attempt: {
        label,
        path,
        detail: `Request failed: ${message}`,
      },
    };
  }
}

function buildLoadError(attempts: AdminCatalogLoadAttempt[]): AdminCatalogLoadError {
  const has401 = attempts.some((a) => a.status === 401);
  const has503 = attempts.some((a) => a.status === 503);
  const has500 = attempts.some((a) => a.status && a.status >= 500);

  let message =
    "The Make A Company backend did not return a capability catalog. The UI is not using cached or snapshot data.";
  let hint =
    "The app first calls GET /v1/public/capability-catalog (no auth). If that is unreachable, it tries the secured runtime URL and then GET /v1/admin/catalog with an admin session. Confirm BACKEND_INTERNAL_API_BASE_URL / NEXT_PUBLIC_BACKEND_API_BASE_URL from Next.js to the Go API, deploy a backend that exposes /v1/public/capability-catalog, and check Redis (or SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL) so the catalog can load.";

  if (has401) {
    message =
      "The backend rejected a catalog request (HTTP 401). The public and/or runtime route may require a token, or the admin session was invalid.";
    hint =
      "For server jobs, set CAPABILITY_CATALOG_READ_TOKEN on Next to match the Go server. The public route should not return 401 — if it does, check routing or a proxy stripping the request.";
  } else if (has503) {
    message = "The backend returned service unavailable (HTTP 503) for a catalog route — often the runtime read token is required in production but not configured on the server, or admin auth is disabled for reads.";
    hint = "On the Go process, set CAPABILITY_CATALOG_READ_TOKEN and REQUIRE_CAPABILITY_CATALOG_READ_TOKEN, or leave read-token requirement off in non-production. Ensure Redis is reachable and SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL is set if you rely on orchestrator seeding.";
  } else if (has500) {
    message =
      "The backend returned an error while reading the catalog from Redis (or seeding from slack-orchestrator). Check makeacompany-ai backend logs and catalog store.";
    hint = "Typical fix: set SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL so a missing Redis key can seed, or PUT the catalog with a valid X-Admin-Token.";
  }

  return { message, hint, attempts };
}

function buildPublicLoadError(attempt: AdminCatalogLoadAttempt): AdminCatalogLoadError {
  const status = attempt.status;
  if (status === 401 || status === 403) {
    return {
      message: "The public skills catalog is unexpectedly protected.",
      hint: "GET /v1/public/capability-catalog must be public with no auth checks in front of it (proxy, middleware, or backend route).",
      attempts: [attempt],
    };
  }
  if (status === 500 || (status && status >= 500)) {
    return {
      message: "The backend failed while reading the public skills catalog.",
      hint: "Check backend logs, Redis connectivity, and catalog seeding from slack-orchestrator.",
      attempts: [attempt],
    };
  }
  return {
    message: "The public skills catalog request failed.",
    hint: "Confirm the Next.js app can reach the Go backend at BACKEND_INTERNAL_API_BASE_URL / NEXT_PUBLIC_BACKEND_API_BASE_URL and that /v1/public/capability-catalog responds.",
    attempts: [attempt],
  };
}

export async function getPublicCatalogData(): Promise<AdminCatalogDataResult> {
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  const r0 = await fetchCatalogFromBackend(
    base,
    "/v1/public/capability-catalog",
    "GET /v1/public/capability-catalog (public)",
    undefined
  );
  if (r0.catalog) {
    const { members, skills } = normalizeCatalogToAdminData(r0.catalog);
    return { ok: true, source: "public", members, skills };
  }
  return {
    ok: false,
    members: [],
    skills: [],
    error: buildPublicLoadError(r0.attempt),
  };
}

export async function getAdminCatalogData(): Promise<AdminCatalogDataResult> {
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  const runtimeReadToken = process.env.CAPABILITY_CATALOG_READ_TOKEN?.trim();

  const attempts: AdminCatalogLoadAttempt[] = [];

  const r0 = await fetchCatalogFromBackend(
    base,
    "/v1/public/capability-catalog",
    "GET /v1/public/capability-catalog (no auth; public /skills)",
    undefined
  );
  attempts.push(r0.attempt);
  if (r0.catalog) {
    const { members, skills } = normalizeCatalogToAdminData(r0.catalog);
    return { ok: true, source: "public", members, skills };
  }

  const runtimeHeaders: HeadersInit = runtimeReadToken
    ? { Authorization: `Bearer ${runtimeReadToken}` }
    : {};
  const r1 = await fetchCatalogFromBackend(
    base,
    "/v1/runtime/capability-catalog",
    "GET /v1/runtime/capability-catalog (read token from env if set)",
    Object.keys(runtimeHeaders).length > 0 ? runtimeHeaders : undefined
  );
  attempts.push(r1.attempt);
  if (r1.catalog) {
    const { members, skills } = normalizeCatalogToAdminData(r1.catalog);
    return { ok: true, source: "runtime", members, skills };
  }

  const sessionHeaders = await backendProxyAuthHeaders();
  const hasSession = Object.keys(sessionHeaders).length > 0;
  const r2 = await fetchCatalogFromBackend(
    base,
    "/v1/admin/catalog",
    hasSession
      ? "GET /v1/admin/catalog (admin session cookie → Authorization)"
      : "GET /v1/admin/catalog (no admin session cookie — expected to 401 when admin auth is enabled)",
    hasSession ? sessionHeaders : undefined
  );
  attempts.push(r2.attempt);
  if (r2.catalog) {
    const { members, skills } = normalizeCatalogToAdminData(r2.catalog);
    return { ok: true, source: "admin", members, skills };
  }

  return {
    ok: false,
    members: [],
    skills: [],
    error: buildLoadError(attempts),
  };
}

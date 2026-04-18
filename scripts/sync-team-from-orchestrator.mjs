/**
 * Sync `team-snapshot.json` / `skills-snapshot.json`: capability contract from slack-orchestrator;
 * bot display metadata from slack-factory `manifests/` (see SLACK_FACTORY_PATH).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const defaultSlackFactoryPath = path.resolve(repoRoot, "..", "slack-factory");
const slackFactoryPath = process.env.SLACK_FACTORY_PATH
  ? path.resolve(process.env.SLACK_FACTORY_PATH)
  : defaultSlackFactoryPath;

const manifestsRoot = path.join(slackFactoryPath, "manifests");
const outputPath = path.join(repoRoot, "src", "data", "admin", "team-snapshot.json");
const skillsOutputPath = path.join(repoRoot, "src", "data", "admin", "skills-snapshot.json");

const ROLE_MAP = {
  alex: { lane: "sales", roleTitle: "Head of Sales" },
  tim: { lane: "strategy", roleTitle: "Head of Simplifying" },
  ross: { lane: "automation", roleTitle: "Head of Automation" },
  garth: { lane: "internship", roleTitle: "Head of Interns" },
  joanne: { lane: "operations", roleTitle: "Head of Executive Operations" },
};

function optionalEnv(name) {
  return (process.env[name] || "").trim();
}

/**
 * Load the same capability JSON as slack-orchestrator embeds on dispatch.
 * Set ORCHESTRATOR_URL (+ optional ORCHESTRATOR_DEBUG_TOKEN), or CATALOG_JSON_PATH to a file from
 * `go run ./cmd/catalog-export` in slack-orchestrator.
 */
async function loadCapabilityCatalog() {
  const explicitUrl = optionalEnv("ORCHESTRATOR_CAPABILITY_CATALOG_URL");
  const base = optionalEnv("ORCHESTRATOR_URL")?.replace(/\/$/, "");
  const url = explicitUrl || (base ? `${base}/debug/capability-catalog` : "");
  const filePath = optionalEnv("CATALOG_JSON_PATH");

  if (url) {
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
  if (filePath) {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  }
  throw new Error(
    "Missing capability catalog: set ORCHESTRATOR_URL (and ORCHESTRATOR_DEBUG_TOKEN if required), " +
      "ORCHESTRATOR_CAPABILITY_CATALOG_URL, or CATALOG_JSON_PATH to JSON from `go run ./cmd/catalog-export` in slack-orchestrator."
  );
}

function normalizeSkillId(value) {
  return toId(value);
}

function normalizeSkill(raw) {
  const id = normalizeSkillId(raw?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(raw?.label || id),
    description: String(raw?.description || "Shared skill for employee workflows."),
  };
}

function buildSkillsAndAssignments(parsed) {
  const catalogSkills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const normalizedSkills = [];
  const seenIds = new Set();

  for (const skill of catalogSkills) {
    const normalized = normalizeSkill(skill);
    if (!normalized) {
      continue;
    }
    if (seenIds.has(normalized.id)) {
      continue;
    }
    seenIds.add(normalized.id);
    normalizedSkills.push(normalized);
  }

  const employeeSkillIds = {};
  const rawMapping = parsed?.employeeSkillIds ?? {};
  for (const [memberId, skillIds] of Object.entries(rawMapping)) {
    if (!Array.isArray(skillIds)) {
      continue;
    }
    const normalizedMemberId = toId(memberId);
    if (!normalizedMemberId) {
      continue;
    }
    const normalizedSkillIds = [...new Set(skillIds.map((value) => normalizeSkillId(value)).filter(Boolean))];
    employeeSkillIds[normalizedMemberId] = normalizedSkillIds;
  }

  return { skills: normalizedSkills, employeeSkillIds };
}

function getRole(name) {
  const key = name.toLowerCase();
  return ROLE_MAP[key] ?? { lane: "general", roleTitle: "AI Employee" };
}

function normalizeCatalogEmployee(raw) {
  const id = toId(raw?.id);
  if (!id) return null;
  return {
    id,
    label: String(raw?.label || id),
    description: String(raw?.description || ""),
  };
}

function toId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readManifest(
  manifestDirName,
  employeeSkillIds,
  knownSkillIds,
  employeesById
) {
  const manifestPath = path.join(manifestsRoot, manifestDirName, "app-manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  const displayInfo = parsed.display_information || {};
  const botUser = parsed.features?.bot_user || {};
  const displayName = displayInfo.name || manifestDirName;
  const memberId = toId(displayName) || toId(manifestDirName);
  const catalogEmployee = employeesById.get(memberId);
  const role = getRole(memberId);
  const configuredSkillIds = employeeSkillIds[memberId] ?? [];
  const unknownSkillIds = configuredSkillIds.filter((id) => !knownSkillIds.has(id));
  if (unknownSkillIds.length > 0) {
    console.warn(`Unknown skill IDs for ${memberId}: ${unknownSkillIds.join(", ")}`);
  }
  const skillIds = configuredSkillIds.filter((id) => knownSkillIds.has(id));

  return {
    id: memberId,
    displayName: catalogEmployee?.label || displayName,
    botDisplayName: botUser.display_name || catalogEmployee?.label || displayName,
    lane: role.lane,
    roleTitle: role.roleTitle,
    shortDescription:
      catalogEmployee?.description ||
      displayInfo.description ||
      "AI teammate ready for operator workflows.",
    longDescription:
      catalogEmployee?.description ||
      displayInfo.long_description ||
      "AI teammate configured from Slack manifest source of truth.",
    backgroundColor: displayInfo.background_color || "#000000",
    status: "active",
    sourceManifest: `slack-factory/manifests/${manifestDirName}/app-manifest.json`,
    skillIds,
  };
}

function sortMembers(a, b, displayOrder) {
  const ai = displayOrder.indexOf(a.id);
  const bi = displayOrder.indexOf(b.id);
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.displayName.localeCompare(b.displayName);
}

async function main() {
  const rawCatalog = await loadCapabilityCatalog();
  const { skills, employeeSkillIds } = buildSkillsAndAssignments(rawCatalog);

  const catalogEmployees = Array.isArray(rawCatalog?.coreEmployees)
    ? rawCatalog.coreEmployees.map(normalizeCatalogEmployee).filter(Boolean)
    : [];
  const employeesById = new Map(catalogEmployees.map((employee) => [employee.id, employee]));
  const displayOrder = catalogEmployees.map((employee) => employee.id);

  const knownSkillIds = new Set(skills.map((skill) => skill.id));
  const entries = await readdir(manifestsRoot, { withFileTypes: true });
  const manifestDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const members = [];
  for (const dirName of manifestDirs) {
    const manifestPath = path.join(manifestsRoot, dirName, "app-manifest.json");
    try {
      const member = await readManifest(dirName, employeeSkillIds, knownSkillIds, employeesById);
      members.push(member);
    } catch (error) {
      console.warn(`Skipping ${manifestPath}: ${error.message}`);
    }
  }

  members.sort((a, b) => sortMembers(a, b, displayOrder));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "slack-factory/manifests + slack-orchestrator capability catalog",
    employees: members,
  };

  const skillsWithEmployees = skills.map((skill) => ({
    ...skill,
    employeeIds: members.filter((member) => member.skillIds.includes(skill.id)).map((member) => member.id),
  }));

  const skillsPayload = {
    generatedAt: new Date().toISOString(),
    source: "slack-orchestrator capability catalog + slack-factory/manifests",
    skills: skillsWithEmployees,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(skillsOutputPath, `${JSON.stringify(skillsPayload, null, 2)}\n`, "utf8");

  console.log(`Synced ${members.length} team profiles to ${outputPath}`);
  console.log(`Synced ${skillsWithEmployees.length} skills to ${skillsOutputPath}`);
}

main().catch((error) => {
  console.error("Failed to sync team data from slack-factory manifests + orchestrator catalog.");
  console.error(error);
  process.exitCode = 1;
});

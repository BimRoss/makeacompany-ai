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
const skillsCatalogPath = path.join(slackFactoryPath, "skills-catalog.json");
const skillsOutputPath = path.join(repoRoot, "src", "data", "admin", "skills-snapshot.json");

const ROLE_MAP = {
  alex: { lane: "sales", roleTitle: "Head of Sales" },
  tim: { lane: "strategy", roleTitle: "Head of Simplifying" },
  ross: { lane: "automation", roleTitle: "Head of Automation" },
  garth: { lane: "internship", roleTitle: "Head of Interns" },
  joanne: { lane: "operations", roleTitle: "Head of Executive Operations" },
};

const DISPLAY_ORDER = ["ross", "alex", "tim", "joanne", "garth"];

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

async function readSkillsCatalog() {
  const defaults = {
    skills: [],
    employeeSkillIds: {},
  };

  try {
    const raw = await readFile(skillsCatalogPath, "utf8");
    const parsed = JSON.parse(raw);
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

    return {
      skills: normalizedSkills,
      employeeSkillIds,
    };
  } catch (error) {
    console.warn(`No skills catalog loaded from ${skillsCatalogPath}: ${error.message}`);
    return defaults;
  }
}

function getRole(name) {
  const key = name.toLowerCase();
  return ROLE_MAP[key] ?? { lane: "general", roleTitle: "AI Employee" };
}

function toId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readManifest(manifestDirName, employeeSkillIds, knownSkillIds) {
  const manifestPath = path.join(manifestsRoot, manifestDirName, "app-manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  const displayInfo = parsed.display_information || {};
  const botUser = parsed.features?.bot_user || {};
  const displayName = displayInfo.name || manifestDirName;
  const memberId = toId(displayName) || toId(manifestDirName);
  const role = getRole(memberId);
  const configuredSkillIds = employeeSkillIds[memberId] ?? [];
  const unknownSkillIds = configuredSkillIds.filter((id) => !knownSkillIds.has(id));
  if (unknownSkillIds.length > 0) {
    console.warn(`Unknown skill IDs for ${memberId}: ${unknownSkillIds.join(", ")}`);
  }
  const skillIds = configuredSkillIds.filter((id) => knownSkillIds.has(id));

  return {
    id: memberId,
    displayName,
    botDisplayName: botUser.display_name || displayName,
    lane: role.lane,
    roleTitle: role.roleTitle,
    shortDescription: displayInfo.description || "AI teammate ready for operator workflows.",
    longDescription:
      displayInfo.long_description ||
      "AI teammate configured from Slack manifest source of truth.",
    backgroundColor: displayInfo.background_color || "#000000",
    status: "active",
    sourceManifest: `slack-factory/manifests/${manifestDirName}/app-manifest.json`,
    skillIds,
  };
}

function sortMembers(a, b) {
  const ai = DISPLAY_ORDER.indexOf(a.id);
  const bi = DISPLAY_ORDER.indexOf(b.id);
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.displayName.localeCompare(b.displayName);
}

async function main() {
  const { skills, employeeSkillIds } = await readSkillsCatalog();
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
      const member = await readManifest(dirName, employeeSkillIds, knownSkillIds);
      members.push(member);
    } catch (error) {
      console.warn(`Skipping ${manifestPath}: ${error.message}`);
    }
  }

  members.sort(sortMembers);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "slack-factory/manifests + slack-factory/skills-catalog.json",
    employees: members,
  };

  const skillsWithEmployees = skills.map((skill) => ({
    ...skill,
    employeeIds: members.filter((member) => member.skillIds.includes(skill.id)).map((member) => member.id),
  }));

  const skillsPayload = {
    generatedAt: new Date().toISOString(),
    source: "slack-factory/skills-catalog.json + slack-factory/manifests",
    skills: skillsWithEmployees,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(skillsOutputPath, `${JSON.stringify(skillsPayload, null, 2)}\n`, "utf8");

  console.log(`Synced ${members.length} team profiles to ${outputPath}`);
  console.log(`Synced ${skillsWithEmployees.length} skills to ${skillsOutputPath}`);
}

main().catch((error) => {
  console.error("Failed to sync team data from slack-factory manifests.");
  console.error(error);
  process.exitCode = 1;
});

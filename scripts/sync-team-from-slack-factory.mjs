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

const ROLE_MAP = {
  alex: { lane: "sales", roleTitle: "Head of Sales" },
  tim: { lane: "strategy", roleTitle: "Head of Simplifying" },
  ross: { lane: "automation", roleTitle: "Head of Automation" },
  garth: { lane: "internship", roleTitle: "Head of Interns" },
  joanne: { lane: "operations", roleTitle: "Head of Executive Operations" },
};

const DISPLAY_ORDER = ["ross", "alex", "tim", "joanne", "garth"];

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

async function readManifest(manifestDirName) {
  const manifestPath = path.join(manifestsRoot, manifestDirName, "app-manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  const displayInfo = parsed.display_information || {};
  const botUser = parsed.features?.bot_user || {};
  const displayName = displayInfo.name || manifestDirName;
  const memberId = toId(displayName) || toId(manifestDirName);
  const role = getRole(memberId);

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
  const entries = await readdir(manifestsRoot, { withFileTypes: true });
  const manifestDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const members = [];
  for (const dirName of manifestDirs) {
    const manifestPath = path.join(manifestsRoot, dirName, "app-manifest.json");
    try {
      const member = await readManifest(dirName);
      members.push(member);
    } catch (error) {
      console.warn(`Skipping ${manifestPath}: ${error.message}`);
    }
  }

  members.sort(sortMembers);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "slack-factory/manifests",
    employees: members,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Synced ${members.length} team profiles to ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to sync team data from slack-factory manifests.");
  console.error(error);
  process.exitCode = 1;
});

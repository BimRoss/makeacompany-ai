import type { TeamLane, TeamMember } from "@/lib/admin/team";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export type AgentsRosterEmployee = {
  id: string;
  displayName: string;
  botDisplayName: string;
  lane: string;
  roleTitle: string;
  shortDescription: string;
};

export type AgentsRosterResult =
  | { ok: true; employees: AgentsRosterEmployee[]; source: string }
  | { ok: false; employees: []; error: string; status?: number };

const KNOWN_LANES = new Set<TeamLane>([
  "automation",
  "sales",
  "strategy",
  "operations",
  "internship",
  "general",
]);

/**
 * Canonical squad roster from agents-mcp-server via the Go backend proxy (`GET /v1/public/agents-roster`).
 * Ordering and membership match `agents.Supported` in agents-mcp-server — no duplicated id list in this repo.
 */
export async function getPublicAgentsRoster(): Promise<AgentsRosterResult> {
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  const url = `${base}/v1/public/agents-roster`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.trim().split(/\r?\n/)[0] ?? "";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) detail = parsed.error;
      } catch {
        // non-JSON
      }
      return {
        ok: false,
        employees: [],
        status: response.status,
        error: detail || `HTTP ${response.status}`,
      };
    }
    const payload = JSON.parse(text) as {
      employees?: AgentsRosterEmployee[];
      source?: string;
    };
    const raw = Array.isArray(payload?.employees) ? payload.employees : [];
    const employees = raw.map((row) => ({
      id: String(row?.id ?? "").trim().toLowerCase(),
      displayName: String(row?.displayName ?? "").trim(),
      botDisplayName: String(row?.botDisplayName ?? "").trim(),
      lane: String(row?.lane ?? "").trim(),
      roleTitle: String(row?.roleTitle ?? "").trim(),
      shortDescription: String(row?.shortDescription ?? "").trim(),
    }));
    return {
      ok: true,
      employees,
      source: String(payload?.source ?? ""),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, employees: [], error: `agents-roster request failed: ${message}` };
  }
}

export function rosterEmployeeToTeamMember(row: AgentsRosterEmployee): TeamMember {
  const id = row.id.trim().toLowerCase();
  const laneRaw = row.lane.trim().toLowerCase();
  const lane: TeamLane = KNOWN_LANES.has(laneRaw as TeamLane)
    ? (laneRaw as TeamLane)
    : "general";
  const displayName = row.displayName.trim() || titleCaseId(id);
  const botDisplayName = row.botDisplayName.trim() || displayName;
  const shortDescription =
    row.shortDescription.trim() ||
    "AI teammate configured from the agents runtime roster.";
  return {
    id,
    displayName,
    botDisplayName,
    lane,
    roleTitle: row.roleTitle.trim() || "AI Employee",
    shortDescription,
    longDescription: shortDescription,
    backgroundColor: "#000000",
    status: "active",
    sourceManifest: "agents-mcp-server:roster",
    skillIds: [],
  };
}

/** Merge skill id chips onto roster rows using repo snapshot `team-snapshot.json` (offline tool routing map). */
export function mergeRosterWithSnapshotSkills(
  rosterMembers: TeamMember[],
  snapshotMembers: TeamMember[],
): TeamMember[] {
  const skillIdsById = new Map(snapshotMembers.map((member) => [member.id, member.skillIds]));
  return rosterMembers.map((member) => ({
    ...member,
    skillIds: skillIdsById.get(member.id) ?? member.skillIds,
  }));
}

function titleCaseId(id: string): string {
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

import type { AdminSkill } from "@/lib/admin/team";
import { getAdminSkills } from "@/lib/admin/skills";

export type AgentSkill = {
  name: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  updatedAt?: string;
};

export type AgentSkillsResult =
  | { ok: true; skills: AgentSkill[]; source: string }
  | { ok: false; skills: []; status?: number; error: string };

/**
 * Fetches markdown-backed Agent Skills from the makeacompany backend, which proxies skills-mcp-server
 * `GET /api/skills` (read-only). Does **not** include the skill instructions body — only summary fields
 * for `/admin` and `/skills` cards.
 */
export async function getAgentSkills(): Promise<AgentSkillsResult> {
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  const url = `${base}/v1/public/agent-skills`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.trim().split(/\r?\n/)[0] ?? "";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) detail = parsed.error;
      } catch {
        // non-JSON; keep first-line text
      }
      return {
        ok: false,
        skills: [],
        status: response.status,
        error: detail || `HTTP ${response.status}`,
      };
    }
    const payload = JSON.parse(text) as { skills?: AgentSkill[]; source?: string };
    const skills = Array.isArray(payload?.skills) ? payload.skills : [];
    return { ok: true, skills, source: String(payload?.source ?? "") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, skills: [], error: `agent-skills request failed: ${message}` };
  }
}

function titleCaseSkillId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function employeeIdsFromMetadata(meta?: Record<string, string>): string[] {
  if (!meta) return [];
  const single = meta.employee ?? meta.primaryEmployee ?? meta.owner;
  if (single?.trim()) {
    return [single.trim().toLowerCase()];
  }
  const csv = meta.employees ?? meta.assignees;
  if (!csv?.trim()) return [];
  return csv
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function agentSkillsToAdminSkills(skills: AgentSkill[]): AdminSkill[] {
  return skills.map((s) => {
    const id = String(s.name ?? "").trim();
    return {
      id,
      label: titleCaseSkillId(id) || id,
      description: String(s.description ?? "").trim(),
      employeeIds: employeeIdsFromMetadata(s.metadata),
    };
  });
}

/** Prefer live skills-mcp fields; merge repo snapshot for labels / assignees MCP omits. */
export function buildTeamCardSkills(agentResult: AgentSkillsResult): AdminSkill[] {
  const snapshot = getAdminSkills();
  const snapById = new Map(snapshot.map((skill) => [skill.id, skill]));
  if (!agentResult.ok || agentResult.skills.length === 0) {
    return snapshot;
  }
  const merged: AdminSkill[] = [];
  const seen = new Set<string>();
  for (const s of agentSkillsToAdminSkills(agentResult.skills)) {
    seen.add(s.id);
    const snap = snapById.get(s.id);
    if (!snap) {
      merged.push(s);
      continue;
    }
    merged.push({
      ...snap,
      description: s.description || snap.description,
      label: snap.label || s.label,
      employeeIds: s.employeeIds.length > 0 ? s.employeeIds : snap.employeeIds,
    });
  }
  for (const s of snapshot) {
    if (!seen.has(s.id)) merged.push(s);
  }
  return merged;
}

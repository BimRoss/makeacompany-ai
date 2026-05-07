import { headers } from "next/headers";

import { AdminShell } from "@/components/admin/admin-shell";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import {
  getPublicAgentsRoster,
  mergeRosterWithSnapshotSkills,
  rosterEmployeeToTeamMember,
} from "@/lib/admin/agents-roster";
import { buildTeamCardSkills, getAgentSkills } from "@/lib/admin/agent-skills";
import { getAdminTeamMembers } from "@/lib/admin/team";
import type { TeamMember } from "@/lib/admin/team";
import { requestHostLooksLoopback } from "@/lib/admin/browser-loopback";

export default async function EmployeesPage() {
  const snapshotMembers = getAdminTeamMembers();
  const [rosterResult, agentSkillsResult] = await Promise.all([getPublicAgentsRoster(), getAgentSkills()]);
  const skills = buildTeamCardSkills(agentSkillsResult);

  let members: TeamMember[] = [];
  if (rosterResult.ok && rosterResult.employees.length > 0) {
    const rosterCards = rosterResult.employees.map(rosterEmployeeToTeamMember);
    members = mergeRosterWithSnapshotSkills(rosterCards, snapshotMembers);
  } else if (snapshotMembers.length > 0) {
    members = snapshotMembers;
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const requestLoopbackHost = requestHostLooksLoopback(host);

  const rosterFailed = !(rosterResult.ok && rosterResult.employees.length > 0);

  return (
    <AdminShell>
      <section className="space-y-4">
        {rosterFailed && snapshotMembers.length > 0 ? (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Agents roster is unavailable ({rosterResult.ok ? "empty payload" : rosterResult.error}). Showing the
            team layout from the committed snapshot instead. For live data, configure{" "}
            <span className="font-mono">AGENTS_MCP_BASE_URL</span> on the backend (see agents-mcp-server compose).
          </div>
        ) : null}
        {!rosterFailed && !agentSkillsResult.ok ? (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            skills-mcp-server list is unreachable ({agentSkillsResult.error}). Skill pills use repo snapshot labels
            only — set <span className="font-mono">SKILLS_MCP_BASE_URL</span> for live summaries.
          </div>
        ) : null}
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The agents roster proxy did not return employees and the repo snapshot has no fallback rows. For local
              Docker, set <span className="font-mono">AGENTS_MCP_BASE_URL</span> (agents-mcp-server) or regenerate{" "}
              <span className="font-mono">team-snapshot.json</span>.
            </p>
          </div>
        ) : (
          <TeamCardsGrid
            members={members}
            skills={skills}
            requestLoopbackHost={requestLoopbackHost}
            redirectUnauthorizedToAdminLogin={false}
          />
        )}
      </section>
    </AdminShell>
  );
}

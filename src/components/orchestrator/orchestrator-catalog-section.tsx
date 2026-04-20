import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export async function OrchestratorCatalogSection() {
  const { members, skills } = await getAdminCatalogData();

  return (
    <div className="space-y-10">
      <section id="employees" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Employees</h2>
        <p className="text-sm text-muted-foreground">
          Read-only runtime capability catalog: backend{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GET /v1/runtime/capability-catalog</code>{" "}
          (Redis plus code defaults aligned with slack-orchestrator). Slack uses the contract on dispatch → NATS →
          employee-factory.
        </p>
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              When the catalog is available from the backend, employee cards appear here automatically.
            </p>
          </div>
        ) : (
          <TeamCardsGrid members={members} skills={skills} />
        )}
      </section>

      <section id="skills" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Skills</h2>
        <p className="text-sm text-muted-foreground">Configured skills from the same read-only catalog as /skills.</p>
        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No skills configured yet.</p>
          </div>
        ) : (
          <SkillsCardsGrid skills={skills} members={members} showToolParams />
        )}
      </section>
    </div>
  );
}

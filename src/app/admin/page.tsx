import { AdminCompanyChannelsStrip } from "@/components/admin/admin-company-channels-strip";
import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { OrchestratorDebugPanel } from "@/components/orchestrator/orchestrator-debug-panel";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function AdminPage() {
  const { skills, members } = await getAdminCatalogData();

  return (
    <AdminShell>
      <div className="space-y-10">
        <AdminCompanyChannelsStrip />
        <section className="space-y-4" aria-labelledby="admin-skills-heading">
          <h2 id="admin-skills-heading" className="text-lg font-semibold leading-snug tracking-tight">
            Skills
          </h2>
          {skills.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <p className="text-base font-medium text-foreground">No skills in the catalog yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Seed or update Redis upstream, or rely on backend defaults after deploy.
              </p>
            </div>
          ) : (
            <SkillsCardsGrid skills={skills} members={members} readOnly showToolParams />
          )}
        </section>
        <OrchestratorDebugPanel />
      </div>
    </AdminShell>
  );
}

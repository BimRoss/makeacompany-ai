import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function SkillsPage() {
  const { skills, members } = await getAdminCatalogData();

  return (
    <AdminShell>
      <section className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Data comes from the runtime capability catalog served by the backend (Redis{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">makeacompany:catalog:capabilities:v1</code>, merged
            with code defaults aligned with{" "}
            <a
              className="text-foreground underline underline-offset-4 hover:opacity-90"
              href="https://github.com/BimRoss/slack-orchestrator"
              rel="noreferrer"
              target="_blank"
            >
              slack-orchestrator
            </a>
            ). Slack bots use the contract shipped on dispatch; this page is for display only.
          </p>
        </div>
        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No skills in the catalog yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Seed or update Redis upstream, or rely on backend defaults after deploy.
            </p>
          </div>
        ) : (
          <SkillsCardsGrid skills={skills} members={members} />
        )}
      </section>
    </AdminShell>
  );
}

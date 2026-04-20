import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function SkillsPage() {
  const { skills, members } = await getAdminCatalogData();

  return (
    <AdminShell>
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
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

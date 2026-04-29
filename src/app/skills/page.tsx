import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { getPublicCatalogData } from "@/lib/admin/catalog";

export default async function SkillsPage() {
  const result = await getPublicCatalogData();
  const skills = result.ok ? result.skills : [];
  const members = result.ok ? result.members : [];

  return (
    <AdminShell>
      <section className="space-y-4">
        {!result.ok ? (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Catalog is temporarily unavailable. Showing page without skills cards.
          </div>
        ) : null}
        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No skills in the catalog yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The backend returned an empty skills list. Check Redis and orchestrator seeding.
            </p>
          </div>
        ) : (
          <SkillsCardsGrid skills={skills} members={members} showToolParams />
        )}
      </section>
    </AdminShell>
  );
}

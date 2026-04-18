import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import { comingSoonSkills } from "@/lib/admin/coming-soon-skills";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function SkillsPage() {
  const { skills: configuredSkills, members } = await getAdminCatalogData();
  const skills = [...configuredSkills, ...comingSoonSkills];

  return (
    <AdminShell>
      <section className="space-y-4">
        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No skills have been configured yet. Add them upstream and re-run the team sync.
            </p>
          </div>
        ) : (
          <SkillsCardsGrid skills={skills} members={members} />
        )}
      </section>
    </AdminShell>
  );
}

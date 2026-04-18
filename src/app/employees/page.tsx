import { AdminShell } from "@/components/admin/admin-shell";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function EmployeesPage() {
  const { members, skills } = await getAdminCatalogData();

  return (
    <AdminShell>
      <section className="space-y-4">
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Run <code className="rounded bg-muted px-1.5 py-0.5">npm run sync:team</code> to import agents from{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">slack-factory</code>.
            </p>
          </div>
        ) : (
          <TeamCardsGrid members={members} skills={skills} />
        )}
      </section>
    </AdminShell>
  );
}

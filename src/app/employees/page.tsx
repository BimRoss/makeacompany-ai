import { AdminShell } from "@/components/admin/admin-shell";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";

export default async function EmployeesPage() {
  const { members, skills } = await getAdminCatalogData();

  return (
    <AdminShell>
      <section className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Employees</h1>
          <p className="text-sm text-muted-foreground">
            Read-only. Same runtime capability catalog as{" "}
            <a className="text-foreground underline underline-offset-4 hover:opacity-90" href="/skills">
              /skills
            </a>{" "}
            (backend + Redis; contract family matches slack-orchestrator). Not editable here.
          </p>
        </div>
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              When the backend returns the catalog (defaults or Redis), employees appear here automatically.
            </p>
          </div>
        ) : (
          <TeamCardsGrid members={members} skills={skills} />
        )}
      </section>
    </AdminShell>
  );
}

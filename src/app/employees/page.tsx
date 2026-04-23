import { headers } from "next/headers";

import { AdminShell } from "@/components/admin/admin-shell";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import { getAdminCatalogData } from "@/lib/admin/catalog";
import { requestHostLooksLoopback } from "@/lib/admin/browser-loopback";

export default async function EmployeesPage() {
  const { members, skills } = await getAdminCatalogData();
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const requestLoopbackHost = requestHostLooksLoopback(host);

  return (
    <AdminShell>
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Employees</h1>
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              When the backend returns the catalog (defaults or Redis), employees appear here automatically.
            </p>
          </div>
        ) : (
          <TeamCardsGrid members={members} skills={skills} requestLoopbackHost={requestLoopbackHost} />
        )}
      </section>
    </AdminShell>
  );
}

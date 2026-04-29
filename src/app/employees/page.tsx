import { headers } from "next/headers";

import { AdminShell } from "@/components/admin/admin-shell";
import { TeamCardsGrid } from "@/components/admin/team-cards-grid";
import { getPublicCatalogData } from "@/lib/admin/catalog";
import { requestHostLooksLoopback } from "@/lib/admin/browser-loopback";

export default async function EmployeesPage() {
  const result = await getPublicCatalogData();
  const members = result.ok ? result.members : [];
  const skills = result.ok ? result.skills : [];
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const requestLoopbackHost = requestHostLooksLoopback(host);

  return (
    <AdminShell>
      <section className="space-y-4">
        {!result.ok ? (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Catalog is temporarily unavailable. Showing page without member cards.
          </div>
        ) : null}
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The backend returned an empty employee list. Check Redis and orchestrator seeding.
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

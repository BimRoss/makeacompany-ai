import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingRegistry } from "@/components/marketing/marketing-registry";
import { resolveMarketingSession } from "@/lib/marketing-session";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const session = await resolveMarketingSession();

  if (session.kind === "unauthenticated") {
    redirect("/admin/login?auth=stale_session");
  }

  if (session.kind === "unavailable") {
    return (
      <AdminShell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-base font-medium text-foreground">Could not verify marketing session</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The admin backend did not respond ({session.reason}). Try again in a moment.
          </p>
        </div>
      </AdminShell>
    );
  }

  if (session.kind === "forbidden") {
    return (
      <AdminShell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-base font-medium text-foreground">Forbidden</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account ({session.email}) is not on the marketing allowlist. Ask Grant to add you.
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <MarketingRegistry currentUserEmail={session.email} />
    </AdminShell>
  );
}

import Link from "next/link";

import { AdminSlackWorkspaceLiveSyncOnce } from "@/components/admin/admin-slack-workspace-live-sync-once";
import { AdminPostAuthWelcomeBoundary } from "@/components/admin/admin-post-auth-welcome-toast";
import { AdminObservabilityShell } from "@/components/admin/observability/observability-shell";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminSlackUsersTable, AdminStripeUsersTable } from "@/components/admin/user-profiles-panel";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminSlackWorkspaceLiveSyncOnce />
      <AdminPostAuthWelcomeBoundary />
      <div className="space-y-6">
        <div className="flex justify-end">
          <Link
            href="/admin/agents"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            Agents →
          </Link>
        </div>
        <AdminObservabilityShell />
        <AdminSlackUsersTable />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

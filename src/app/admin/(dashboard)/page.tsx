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
        {/* OAuthPoolPanel (rate-limit headroom) is rendered inside
            AdminObservabilityShell right under the "Updated" toolbar so the
            combined-pool draw is the first thing visible. */}
        <AdminObservabilityShell />
        <AdminSlackUsersTable />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

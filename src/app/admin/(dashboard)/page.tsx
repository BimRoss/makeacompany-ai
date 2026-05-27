import { AdminSlackWorkspaceLiveSyncOnce } from "@/components/admin/admin-slack-workspace-live-sync-once";
import { AdminPostAuthWelcomeBoundary } from "@/components/admin/admin-post-auth-welcome-toast";
import { AdminGa4Summary } from "@/components/admin/admin-ga4-summary";
import { AdminObservabilityShell } from "@/components/admin/observability/observability-shell";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminSlackUsersTable, AdminStripeUsersTable } from "@/components/admin/user-profiles-panel";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminSlackWorkspaceLiveSyncOnce />
      <AdminPostAuthWelcomeBoundary />
      <div className="space-y-12">
        <AdminGa4Summary />
        <AdminObservabilityShell />
        <AdminSlackUsersTable />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

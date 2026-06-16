import { AdminSlackWorkspaceLiveSyncOnce } from "@/components/admin/admin-slack-workspace-live-sync-once";
import { AdminPostAuthWelcomeBoundary } from "@/components/admin/admin-post-auth-welcome-toast";
import { AdminObservabilityShell } from "@/components/admin/observability/observability-shell";
import { AdminShell } from "@/components/admin/admin-shell";
import { OAuthPoolPanel } from "@/components/admin/oauth-pool-panel";
import { AdminSlackUsersTable, AdminStripeUsersTable } from "@/components/admin/user-profiles-panel";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminSlackWorkspaceLiveSyncOnce />
      <AdminPostAuthWelcomeBoundary />
      <div className="space-y-6">
        {/* OAuthPoolPanel (rate-limit headroom) lifted above the
            ObservabilityShell so the shared-pool draw is visible without a
            scroll — it's the single most actionable signal on the page. */}
        <OAuthPoolPanel />
        <AdminObservabilityShell />
        <AdminSlackUsersTable />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

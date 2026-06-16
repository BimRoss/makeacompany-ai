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
        {/* ObservabilityShell first so its sticky toolbar (Updated…) and
            GoldenPath land at the very top. AdminAgentKillSwitch (the big
            Joanne/Ross Live pills) removed — the controls were duplicated
            in the sticky compact strip below, and both now live elsewhere
            in /admin when we need them. */}
        <AdminObservabilityShell />
        <OAuthPoolPanel />
        <AdminSlackUsersTable />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

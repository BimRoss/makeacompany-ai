import { AdminSlackWorkspaceLiveSyncOnce } from "@/components/admin/admin-slack-workspace-live-sync-once";
import { AdminPostAuthWelcomeBoundary } from "@/components/admin/admin-post-auth-welcome-toast";
import { AdminCompanyChannelsStrip } from "@/components/admin/admin-company-channels-strip";
import { AdminAgentsAllGrafanaEmbed } from "@/components/admin/admin-agents-all-grafana-embed";
import { AdminCronJobsGrafanaEmbed } from "@/components/admin/admin-cronjobs-grafana-embed";
import { AdminOverviewGrafanaGrid } from "@/components/admin/admin-overview-grafana-grid";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminSlackUsersTable, AdminStripeUsersTable } from "@/components/admin/user-profiles-panel";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminSlackWorkspaceLiveSyncOnce />
      <AdminPostAuthWelcomeBoundary />
      <div className="space-y-10">
        <div className="space-y-4">
          <AdminOverviewGrafanaGrid />
          <AdminAgentsAllGrafanaEmbed />
          <AdminCronJobsGrafanaEmbed />
        </div>
        <AdminSlackUsersTable />
        <AdminCompanyChannelsStrip />
        <AdminStripeUsersTable />
      </div>
    </AdminShell>
  );
}

import { AdminCompanyChannelsStrip } from "@/components/admin/admin-company-channels-strip";
import { AdminShell } from "@/components/admin/admin-shell";
import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";
import { OrchestratorDebugPanel } from "@/components/orchestrator/orchestrator-debug-panel";

export default function AdminPage() {
  return (
    <AdminShell>
      <div className="space-y-10">
        <ServiceGrafanaDashboard
          embedsKey="agentsGrafanaEmbeds"
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        />
        <AdminCompanyChannelsStrip />
        <OrchestratorDebugPanel />
      </div>
    </AdminShell>
  );
}

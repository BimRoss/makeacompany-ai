import { AdminShell } from "@/components/admin/admin-shell";
import { AdminServiceNav } from "@/components/admin/admin-service-nav";
import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";
import { OrchestratorDebugPanel } from "@/components/orchestrator/orchestrator-debug-panel";

export default function OrchestratorPage() {
  return (
    <AdminShell>
      <AdminServiceNav />
      <div className="space-y-10">
        <ServiceGrafanaDashboard
          embedsKey="slackOrchestratorGrafanaEmbeds"
          title="Slack orchestrator"
          description="Events API acks, JetStream publish latency, and worker fan-out — same stream employee-factory consumes."
        />
        <OrchestratorDebugPanel />
      </div>
    </AdminShell>
  );
}

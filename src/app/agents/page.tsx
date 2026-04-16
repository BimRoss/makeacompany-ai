import { AdminShell } from "@/components/admin/admin-shell";
import { AdminServiceNav } from "@/components/admin/admin-service-nav";
import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";

export default function AgentsPage() {
  return (
    <AdminShell>
      <AdminServiceNav />
      <ServiceGrafanaDashboard
        embedsKey="agentsGrafanaEmbeds"
        title="Employee factory (agents)"
        description="Per-pod Slack throughput, orchestrator→worker ingress, and runtime health for the squad bots."
      />
    </AdminShell>
  );
}

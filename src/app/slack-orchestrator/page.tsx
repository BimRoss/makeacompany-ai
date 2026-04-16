import { AdminShell } from "@/components/admin/admin-shell";
import { AdminServiceNav } from "@/components/admin/admin-service-nav";
import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";

export default function SlackOrchestratorPage() {
  return (
    <AdminShell>
      <AdminServiceNav />
      <ServiceGrafanaDashboard
        embedsKey="slackOrchestratorGrafanaEmbeds"
        title="Slack orchestrator"
        description="Socket Mode ingress, Events API acks, and JetStream fan-out to employee-factory workers (same NATS stream as runtime)."
      />
    </AdminShell>
  );
}

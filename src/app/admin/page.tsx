import { AdminShell } from "@/components/admin/admin-shell";
import { AdminCatalogEditor } from "@/components/admin/admin-catalog-editor";
import { AdminCompanyChannelsStrip } from "@/components/admin/admin-company-channels-strip";
import { AdminOverviewGrafanaGrid } from "@/components/admin/admin-overview-grafana-grid";
import { AdminServiceNav } from "@/components/admin/admin-service-nav";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminServiceNav />
      <AdminOverviewGrafanaGrid />
      <AdminCompanyChannelsStrip />
      <AdminCatalogEditor />
    </AdminShell>
  );
}

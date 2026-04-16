import { AdminHealthDashboard } from "@/components/admin/admin-health-dashboard";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminServiceNav } from "@/components/admin/admin-service-nav";

export default function TwitterPage() {
  return (
    <AdminShell>
      <AdminServiceNav />
      <AdminHealthDashboard />
    </AdminShell>
  );
}

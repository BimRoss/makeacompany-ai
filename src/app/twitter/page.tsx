import { AdminHealthDashboard } from "@/components/admin/admin-health-dashboard";
import { AdminShell } from "@/components/admin/admin-shell";

export default function TwitterPage() {
  return (
    <AdminShell>
      <AdminHealthDashboard />
    </AdminShell>
  );
}

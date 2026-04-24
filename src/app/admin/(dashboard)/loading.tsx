import { AdminShell } from "@/components/admin/admin-shell";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";

export default function AdminDashboardLoading() {
  return (
    <AdminShell>
      <CompanyChannelPageLoader srLabel="Loading admin dashboard" />
    </AdminShell>
  );
}

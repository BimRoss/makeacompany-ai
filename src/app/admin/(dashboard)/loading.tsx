import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminDashboardLoading() {
  return (
    <AdminShell>
      <p role="status" className="px-4 py-8 text-sm text-muted-foreground">
        Loading admin dashboard…
      </p>
    </AdminShell>
  );
}

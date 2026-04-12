import { AdminShell } from "@/components/admin/admin-shell";
import { AdminCatalogEditor } from "@/components/admin/admin-catalog-editor";

export default function AdminPage() {
  return (
    <AdminShell>
      <AdminCatalogEditor />
    </AdminShell>
  );
}

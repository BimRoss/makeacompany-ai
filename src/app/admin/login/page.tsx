import { Suspense } from "react";
import { AdminLoginClient } from "@/components/admin/admin-login-client";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginClient />
    </Suspense>
  );
}

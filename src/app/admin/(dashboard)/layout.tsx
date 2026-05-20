import { Suspense, type ReactNode } from "react";

import { AdminFlashToastProvider } from "@/components/admin/admin-flash-toast";
import { AdminSessionVerifiedBoundary } from "@/components/admin/admin-session-verified-boundary";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AdminFlashToastProvider>
      <Suspense
        fallback={
          <AdminShell>
            <p role="status" className="px-4 py-8 text-sm text-muted-foreground">
              Loading admin dashboard…
            </p>
          </AdminShell>
        }
      >
        <AdminSessionVerifiedBoundary>{children}</AdminSessionVerifiedBoundary>
      </Suspense>
    </AdminFlashToastProvider>
  );
}

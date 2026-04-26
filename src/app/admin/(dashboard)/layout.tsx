import { Suspense, type ReactNode } from "react";

import { AdminFlashToastProvider } from "@/components/admin/admin-flash-toast";
import { AdminSessionVerifiedBoundary } from "@/components/admin/admin-session-verified-boundary";
import { AdminShell } from "@/components/admin/admin-shell";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AdminFlashToastProvider>
      <Suspense
        fallback={
          <AdminShell>
            <CompanyChannelPageLoader srLabel="Loading admin dashboard" />
          </AdminShell>
        }
      >
        <AdminSessionVerifiedBoundary>{children}</AdminSessionVerifiedBoundary>
      </Suspense>
    </AdminFlashToastProvider>
  );
}

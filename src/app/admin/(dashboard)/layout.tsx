import { Suspense, type ReactNode } from "react";

import { AdminSessionVerifiedBoundary } from "@/components/admin/admin-session-verified-boundary";
import { AdminShell } from "@/components/admin/admin-shell";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";

export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <AdminShell>
          <CompanyChannelPageLoader srLabel="Loading admin dashboard" />
        </AdminShell>
      }
    >
      <AdminSessionVerifiedBoundary>{children}</AdminSessionVerifiedBoundary>
    </Suspense>
  );
}

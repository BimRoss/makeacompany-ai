import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { AdminSessionVerifiedBoundary } from "@/components/admin/admin-session-verified-boundary";
import { AdminShell } from "@/components/admin/admin-shell";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";

export const metadata: Metadata = {
  title: "Twitter",
  description: "Twitter operations dashboard for makeacompany.ai",
  alternates: {
    canonical: "/twitter",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function TwitterLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <AdminShell>
          <CompanyChannelPageLoader srLabel="Loading Twitter dashboard" />
        </AdminShell>
      }
    >
      <AdminSessionVerifiedBoundary>{children}</AdminSessionVerifiedBoundary>
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { AdminSessionVerifiedBoundary } from "@/components/admin/admin-session-verified-boundary";
import { AdminShell } from "@/components/admin/admin-shell";

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
          <p role="status" className="px-4 py-8 text-sm text-muted-foreground">
            Loading Twitter dashboard…
          </p>
        </AdminShell>
      }
    >
      <AdminSessionVerifiedBoundary>{children}</AdminSessionVerifiedBoundary>
    </Suspense>
  );
}

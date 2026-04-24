import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { verifyAdminServerSession } from "@/lib/backend-proxy-auth";

type Props = {
  children: ReactNode;
};

/**
 * Ensures the admin cookie is still valid in Redis before rendering dashboard children.
 * Stale cookies pass middleware (cookie present) but must not paint protected content.
 */
export async function AdminSessionVerifiedBoundary({ children }: Props) {
  const status = await verifyAdminServerSession();
  if (status === "unauthorized") {
    redirect("/admin/login");
  }
  if (status === "unavailable") {
    return (
      <AdminShell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-base font-medium text-foreground">Could not verify admin session</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The admin backend did not respond. Try again in a moment.
          </p>
        </div>
      </AdminShell>
    );
  }
  return <>{children}</>;
}

import type { ReactNode } from "react";
import { AdminCatalogNavbarTrail } from "@/components/admin/admin-catalog-navbar-trail";
import { AdminHeaderLogoutSlot } from "@/components/admin/admin-header-logout-slot";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <AdminCatalogNavbarTrail />
      <Header endSlot={<AdminHeaderLogoutSlot />} />
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">{children}</div>
      </div>
      <Footer />
    </main>
  );
}

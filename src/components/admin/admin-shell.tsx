import type { ReactNode } from "react";
import { AdminHeaderLogoutSlot } from "@/components/admin/admin-header-logout-slot";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <main className="flex min-h-dvh flex-col bg-background dark:bg-[#040a06]">
      <Header endSlot={<AdminHeaderLogoutSlot />} />
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 pb-6 pt-5 sm:px-6 lg:px-8 lg:pb-8 lg:pt-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">{children}</div>
      </div>
      <Footer />
    </main>
  );
}

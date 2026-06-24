import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { MeHeaderLogoutSlot } from "@/components/me/me-header-logout-slot";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function MeLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header endSlot={<MeHeaderLogoutSlot />} />
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-3 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <Footer />
    </main>
  );
}

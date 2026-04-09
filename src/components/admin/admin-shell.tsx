import type { ReactNode } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 pb-8 pt-6 sm:px-6 sm:pt-8">
        {children}
      </div>
      <Footer />
    </main>
  );
}

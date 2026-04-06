import type { ReactNode } from "react";
import { Header } from "@/components/landing/header";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <main className="min-h-screen bg-background pb-12">
      <Header />
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-8">
        {children}
      </div>
    </main>
  );
}

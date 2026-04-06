import type { ReactNode } from "react";
import Link from "next/link";

type AdminShellProps = {
  children: ReactNode;
  activeTab?: "team" | "health";
};

export function AdminShell({ children, activeTab = "team" }: AdminShellProps) {
  const baseTabClasses =
    "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em]";
  const inactiveTabClasses = `${baseTabClasses} border-border bg-background text-muted-foreground`;
  const activeTabClasses = `${baseTabClasses} border-foreground bg-foreground text-background`;

  return (
    <main className="min-h-screen bg-background px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <header>
          <nav className="flex flex-wrap gap-2">
            <Link href="/admin" className={activeTab === "team" ? activeTabClasses : inactiveTabClasses}>
              Team
            </Link>
            <Link
              href="/admin/health"
              className={activeTab === "health" ? activeTabClasses : inactiveTabClasses}
            >
              Health
            </Link>
          </nav>
        </header>

        {children}
      </div>
    </main>
  );
}

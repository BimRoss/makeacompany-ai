import type { ReactNode } from "react";

type AdminShellProps = {
  children: ReactNode;
  updatedAt: string;
  source: string;
};

export function AdminShell({ children, updatedAt, source }: AdminShellProps) {
  return (
    <main className="min-h-screen bg-background px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                MakeACompany Operator Console
              </p>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Admin Control Surface
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Team is the first module. This surface is designed to become your control plane for
                major company operations.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
              <p>
                Snapshot: <span className="font-semibold text-foreground">{source}</span>
              </p>
              <p>
                Updated: <span className="font-semibold text-foreground">{updatedAt}</span>
              </p>
            </div>
          </div>

          <nav className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <span className="rounded-full border border-foreground bg-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-background">
              Team
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Workflows (Soon)
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Metrics (Soon)
            </span>
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Access (Soon)
            </span>
          </nav>
        </header>

        {children}
      </div>
    </main>
  );
}

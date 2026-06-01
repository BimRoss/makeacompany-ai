import type { Metadata } from "next";
import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

// /me — user-level dashboard landing page (issue #183 / #186 PR5).
// In v1 just links to /me/agents; future per-user surfaces (billing
// summary, etc.) attach here.

export const metadata: Metadata = {
  title: "Your account · makeacompany.ai",
  robots: { index: false, follow: false },
};

export default function MePage() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-start gap-8 px-6 py-12 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Your account
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Per-user surfaces — separate from your company channels.
          </p>
        </div>
        <ul className="w-full divide-y divide-border rounded-2xl border border-border bg-card/80 text-left shadow-sm">
          <li>
            <Link
              href="/me/agents"
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-foreground">Personal agents</div>
                  <div className="text-xs text-muted-foreground">
                    Slack agents that respond only to you, in DMs and shared channels.
                  </div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        </ul>
      </div>
      <Footer />
    </main>
  );
}

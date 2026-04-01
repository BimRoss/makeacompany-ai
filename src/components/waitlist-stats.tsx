"use client";

import { useEffect, useState } from "react";
import { apiBase } from "@/lib/site";

type Stats = { signups: number; amountDisplay: string };

export function WaitlistStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/v1/billing/waitlist-stats`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("Could not load waitlist stats");
        }
        const data = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(data);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Network error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err || stats === null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 px-8 py-5 text-center shadow-sm backdrop-blur-sm">
      <div>
        <p className="font-display text-3xl font-semibold tabular-nums text-[var(--foreground)] sm:text-4xl">
          {stats.signups.toLocaleString()}
        </p>
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted-foreground)]">
          on the waitlist
        </p>
      </div>
      <div className="hidden h-10 w-px bg-[var(--border)] sm:block" aria-hidden />
      <div>
        <p className="font-display text-3xl font-semibold tabular-nums text-[var(--foreground)] sm:text-4xl">
          ${stats.amountDisplay}
        </p>
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted-foreground)]">
          raised
        </p>
      </div>
    </div>
  );
}

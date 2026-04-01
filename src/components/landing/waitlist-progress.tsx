"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { apiBase } from "@/lib/site";

const MAX_WAITLIST = 10000;
const WAITLIST_REFRESH_EVENT = "waitlist:refresh";

type WaitlistStatsResponse = {
  signups: number;
  amountCents: number;
  amountDisplay: string;
};

export function WaitlistProgress() {
  const [data, setData] = useState<WaitlistStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${apiBase()}/v1/billing/waitlist-stats`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("Failed loading waitlist stats");
        }
        const json = (await res.json()) as WaitlistStatsResponse;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Network error");
        }
      }
    }

    load();
    const interval = setInterval(load, 30000);
    const onRefresh = () => {
      void load();
      window.setTimeout(() => void load(), 1500);
    };
    window.addEventListener(WAITLIST_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(WAITLIST_REFRESH_EVENT, onRefresh);
    };
  }, []);

  if (error) {
    return (
      <section className="py-16">
        <div className="mx-auto max-w-2xl px-6">
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm">
            {error}
          </p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="py-16">
        <div className="mx-auto h-24 max-w-2xl px-6" />
      </section>
    );
  }

  const percentage = Math.min((data.signups / MAX_WAITLIST) * 100, 100);
  const spotsLeft = Math.max(MAX_WAITLIST - data.signups, 0);

  return (
    <section className="py-16">
      <div className="mx-auto max-w-2xl px-6">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
                <Users className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Waitlist Progress</p>
                <p className="text-2xl font-bold tabular-nums">
                  {data.signups.toLocaleString()}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    / {MAX_WAITLIST.toLocaleString()}
                  </span>
                </p>
              </div>
            </div>
            <div className="rounded-full border border-border bg-background px-3 py-1 text-sm font-semibold">
              {percentage.toFixed(1)}%
            </div>
          </div>

          <div className="h-3 overflow-hidden rounded-full border border-border bg-muted/20">
            <div
              className="h-full bg-foreground transition-all"
              style={{ width: `${percentage}%` }}
              aria-hidden
            />
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{spotsLeft.toLocaleString()} spots left</span>{" "}
            to claim your free month
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            ${data.amountDisplay} collected so far
          </p>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { ADMIN_STRIPE_WAITLIST_REFRESH_EVENT, DEFAULT_WAITLIST_CAP } from "@/lib/waitlist";

type StripePurchasersPayload = {
  purchasers?: unknown[];
  error?: string;
  message?: string;
};

export function AdminWaitlistProgress() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stripe-waitlist-purchasers", { cache: "no-store" });
      const body = (await res.json()) as StripePurchasersPayload;
      if (!res.ok) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setCount(null);
        return;
      }
      const n = Array.isArray(body.purchasers) ? body.purchasers.length : 0;
      setCount(n);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setCount(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    const onRefresh = () => void load();
    window.addEventListener(ADMIN_STRIPE_WAITLIST_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(ADMIN_STRIPE_WAITLIST_REFRESH_EVENT, onRefresh);
    };
  }, [load]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-center text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (count === null) {
    return <div className="h-24 max-w-2xl rounded-2xl border border-border bg-card/50" aria-hidden />;
  }

  const cap = DEFAULT_WAITLIST_CAP;
  const percentage = Math.min((count / cap) * 100, 100);
  const spotsLeft = Math.max(cap - count, 0);

  return (
    <div className="max-w-2xl rounded-2xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <Users className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Waitlist Progress</p>
            <p className="text-2xl font-bold tabular-nums">
              {count.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">/ {cap.toLocaleString()}</span>
            </p>
          </div>
        </div>
        <div className="rounded-full border border-border bg-background px-3 py-1 text-sm font-semibold tabular-nums">
          {percentage.toFixed(1)}%
        </div>
      </div>

      <div className="h-3 overflow-hidden rounded-full border border-border bg-muted/20">
        <div className="h-full bg-foreground motion-all" style={{ width: `${percentage}%` }} aria-hidden />
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{spotsLeft.toLocaleString()} spots left</span> to claim your
        free month
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { apiBase } from "@/lib/site";

export function CheckoutCTA() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase()}/v1/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        setError(data.error || "Checkout failed");
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("No checkout URL returned");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="font-display relative inline-flex min-h-[52px] min-w-[220px] items-center justify-center rounded-xl bg-[var(--accent)] px-10 py-3 text-lg font-semibold tracking-tight text-[var(--accent-foreground)] shadow-lg transition hover:brightness-105 disabled:opacity-60 sm:min-h-[56px] sm:min-w-[260px] sm:text-xl"
      >
        {loading ? "Opening checkout…" : "Make a company"}
      </button>
      {error ? <p className="max-w-md text-center text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      <p className="text-center text-xs text-[var(--muted-foreground)] sm:text-sm">
        $1 waitlist · Secure checkout with Stripe
      </p>
    </div>
  );
}

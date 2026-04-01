"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { apiBase } from "@/lib/site";

type CheckoutButtonProps = {
  label: string;
  className?: string;
};

export function CheckoutButton({ label, className }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/v1/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Checkout failed");
        setLoading(false);
        return;
      }
      if (!data.url) {
        setError("No checkout URL returned");
        setLoading(false);
        return;
      }
      // Keep button disabled while the browser transitions to Stripe.
      window.location.assign(data.url);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={onClick}
        className={`group inline-flex h-14 items-center justify-center rounded-lg bg-primary px-8 text-lg font-semibold text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 ${className ?? ""}`}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-white" />
            Opening Stripe...
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </>
        )}
      </button>
      {error ? <p className="rounded-md border border-border bg-card px-3 py-2 text-sm">{error}</p> : null}
    </div>
  );
}

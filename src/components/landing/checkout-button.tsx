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
    <div className="flex w-full flex-col items-center gap-2.5 sm:gap-3">
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={onClick}
        className={`group inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground motion-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 sm:h-14 sm:w-auto sm:px-8 sm:text-lg ${className ?? ""}`}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-white sm:h-5 sm:w-5" />
            Opening Stripe...
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="ml-2 h-4 w-4 motion-transform group-hover:translate-x-1 sm:h-5 sm:w-5" />
          </>
        )}
      </button>
      {error ? (
        <p className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm sm:w-auto">
          {error}
        </p>
      ) : null}
    </div>
  );
}

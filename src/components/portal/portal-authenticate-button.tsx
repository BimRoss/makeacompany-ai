"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type StartPayload = { url?: string; error?: string };

type Props = {
  channelId: string;
  /** When set (e.g. from ?stripe_customer= on login), Checkout prefills that Stripe customer. */
  stripeCustomerId?: string;
};

export function PortalAuthenticateButton({ channelId, stripeCustomerId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPageShow = () => setLoading(false);
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          channelId,
          ...(stripeCustomerId?.trim() ? { stripeCustomerId: stripeCustomerId.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as StartPayload;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start Stripe session");
        setLoading(false);
        return;
      }
      if (!data.url) {
        setError("No checkout URL returned");
        setLoading(false);
        return;
      }
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-4">
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={onClick}
        className="inline-flex h-12 w-full items-center justify-center rounded-xl border-2 border-foreground/15 bg-background px-8 text-base font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 disabled:pointer-events-none disabled:opacity-65 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:hover:border-white/30 dark:focus-visible:outline-white/40"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Please wait…
          </>
        ) : (
          "Login"
        )}
      </button>
      {error ? (
        <p className="w-full rounded-lg border border-border bg-card px-4 py-3 text-center text-sm text-foreground">{error}</p>
      ) : null}
    </div>
  );
}

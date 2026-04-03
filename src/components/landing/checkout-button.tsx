"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { apiBase } from "@/lib/site";
import { DEFAULT_WAITLIST_CAP, WAITLIST_REFRESH_EVENT } from "@/lib/waitlist";

const CHECKOUT_PENDING_KEY = "makeacompany:checkout-pending";

type CheckoutButtonProps = {
  label: string;
  className?: string;
};

type WaitlistStatsResponse = {
  signups: number;
  cap?: number;
  full?: boolean;
};

export function CheckoutButton({ label, className }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<WaitlistStatsResponse | null>(null);

  useEffect(() => {
    function clearPendingCheckout() {
      window.sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
      setLoading(false);
    }

    // Browsers can restore this page from bfcache when users back out of Stripe.
    // Ensure we never stay stuck in a loading/disabled state after return.
    const onPageShow = () => clearPendingCheckout();
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${apiBase()}/v1/billing/waitlist-stats`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          return;
        }
        const json = (await res.json()) as WaitlistStatsResponse;
        if (!cancelled) {
          setStats(json);
        }
      } catch {
        /* keep prior stats */
      }
    }

    void load();
    const onRefresh = () => {
      void load();
      window.setTimeout(() => void load(), 1500);
    };
    window.addEventListener(WAITLIST_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(WAITLIST_REFRESH_EVENT, onRefresh);
    };
  }, []);

  const cap =
    stats && typeof stats.cap === "number" && stats.cap > 0 ? stats.cap : DEFAULT_WAITLIST_CAP;
  const waitlistFull =
    stats !== null && (stats.full === true || stats.signups >= cap);

  async function onClick() {
    if (loading || waitlistFull) {
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
        const msg = data.error ?? "Checkout failed";
        setError(msg);
        window.sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
        setLoading(false);
        if (res.status === 403 && msg.toLowerCase().includes("waitlist")) {
          void fetch(`${apiBase()}/v1/billing/waitlist-stats`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => setStats(j as WaitlistStatsResponse))
            .catch(() => undefined);
        }
        return;
      }
      if (!data.url) {
        setError("No checkout URL returned");
        window.sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
        setLoading(false);
        return;
      }
      // Keep button disabled while the browser transitions to Stripe.
      window.sessionStorage.setItem(CHECKOUT_PENDING_KEY, "1");
      window.location.assign(data.url);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      window.sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-2.5 sm:gap-3">
      <button
        type="button"
        disabled={loading || waitlistFull}
        aria-busy={loading}
        onClick={onClick}
        className={`waitlist-cta group inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground disabled:opacity-70 sm:h-14 sm:w-auto sm:px-8 sm:text-lg ${className ?? ""}`}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-white sm:h-5 sm:w-5" />
            Opening Stripe...
          </>
        ) : waitlistFull ? (
          <>Waitlist full!</>
        ) : (
          <>
            {label}
            <ArrowRight
              className="waitlist-cta-arrow ml-2 h-4 w-4 shrink-0 sm:h-5 sm:w-5"
              aria-hidden
            />
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

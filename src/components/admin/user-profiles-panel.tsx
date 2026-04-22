"use client";

import { useCallback, useEffect, useState } from "react";

type StripeWaitlistPurchaserRow = {
  email: string;
  stripeSessionId: string;
  stripeCustomer: string;
  paymentStatus: string;
  amountTotal: string;
  currency: string;
  checkoutCreated: string;
  source: string;
  waitlistPriceId: string;
};

type StripePurchasersPayload = {
  purchasers?: StripeWaitlistPurchaserRow[];
  error?: string;
  message?: string;
};

function short(s: string, max: number) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t || "—";
  return `${t.slice(0, max - 1)}…`;
}

/** Stripe smallest-currency-unit amounts; zero-decimal currencies are whole units. */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function formatStripeAmount(minorUnits: string, currency: string): string {
  const minor = parseInt(minorUnits, 10);
  if (!Number.isFinite(minor)) return "—";
  const c = (currency || "usd").toUpperCase();
  const major = ZERO_DECIMAL_CURRENCIES.has(c) ? minor : minor / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(major);
  } catch {
    return `${major} ${c}`;
  }
}

/** Stripe checkout customers for the waitlist product (snapshot or live). */
export function UserProfilesPanel() {
  const [stripePurchasers, setStripePurchasers] = useState<StripeWaitlistPurchaserRow[]>([]);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

  const fetchStripePurchasers = useCallback(async (live: boolean) => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const qs = live ? "?source=live" : "";
      const res = await fetch(`/api/admin/stripe-waitlist-purchasers${qs}`, { cache: "no-store" });
      const body = (await res.json()) as StripePurchasersPayload;
      if (!res.ok) {
        setStripeError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setStripePurchasers([]);
        return;
      }
      setStripePurchasers(Array.isArray(body.purchasers) ? body.purchasers : []);
    } catch (e) {
      setStripeError(e instanceof Error ? e.message : "fetch failed");
      setStripePurchasers([]);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    await fetchStripePurchasers(false);
  }, [fetchStripePurchasers]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">Stripe Users</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void refreshSnapshot()}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={stripeLoading}
            onClick={() => void fetchStripePurchasers(true)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
          >
            Query Stripe live
          </button>
        </div>
      </div>

      {stripeError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {stripeError}
        </p>
      ) : null}

      <section className="space-y-3" aria-label="Stripe users">
        {stripePurchasers.length === 0 && !stripeError && !stripeLoading ? (
          <p className="text-sm text-muted-foreground">No rows yet. Use Refresh or Query Stripe live.</p>
        ) : null}
        {stripePurchasers.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Checkout created</th>
                </tr>
              </thead>
              <tbody>
                {stripePurchasers.map((w) => (
                  <tr key={`${w.email}:${w.stripeSessionId}`} className="border-b border-border/80 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{short(w.email, 48)}</td>
                    <td className="px-3 py-2 text-xs">{short(w.paymentStatus, 20)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {w.amountTotal && w.amountTotal !== "0" ? formatStripeAmount(w.amountTotal, w.currency) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {(w.stripeCustomer ?? "").trim() ? (
                        short(w.stripeCustomer, 22)
                      ) : (
                        <span
                          className="font-sans text-muted-foreground"
                          title="No Stripe Customer on this Checkout Session (common for guest checkout)."
                        >
                          Guest
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{short(w.stripeSessionId, 20)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{short(w.checkoutCreated, 24)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

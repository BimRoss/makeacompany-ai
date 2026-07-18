"use client";

import { Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

type StripeWaitlistPurchaserRow = {
  email: string;
  stripeSessionId: string;
  stripeCustomer: string;
  stripeProductId?: string;
  paymentStatus: string;
  amountTotal: string;
  currency: string;
  checkoutCreated: string;
  source: string;
  waitlistPriceId: string;
  /** backend: base_plan | waitlist_deposit */
  priceRole?: string;
};

type StripePurchasersPayload = {
  purchasers?: StripeWaitlistPurchaserRow[];
  error?: string;
  message?: string;
  redisSaveError?: string;
  profileUpsertError?: string;
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

function stripePlanLabel(priceRole: string | undefined): string {
  const r = (priceRole ?? "").trim();
  if (r === "waitlist_deposit") return "Waitlist";
  if (r === "base_plan") return "Monthly";
  return "—";
}

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

/** Stripe waitlist / checkout customers. Mount reads Redis snapshots; live refresh pulls upstream and updates Redis. */
export function AdminStripeUsersTable() {
  const flash = useAdminFlashToast();
  const [stripePurchasers, setStripePurchasers] = useState<StripeWaitlistPurchaserRow[]>([]);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeWriteWarn, setStripeWriteWarn] = useState<string | null>(null);

  const fetchStripePurchasers = useCallback(
    async (live: boolean) => {
      setStripeLoading(true);
      setStripeError(null);
      if (!live) setStripeWriteWarn(null);
      try {
        const qs = live ? "?source=live" : "";
        const res = await fetch(`/api/admin/stripe-waitlist-purchasers${qs}`, { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
          return;
        }
        const body = (await res.json()) as StripePurchasersPayload;
        if (!res.ok) {
          setStripeWriteWarn(null);
          const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
          setStripeError(msg);
          setStripePurchasers([]);
          if (live) flash("error", msg);
          return;
        }
        setStripePurchasers(Array.isArray(body.purchasers) ? body.purchasers : []);
        if (live) {
          const parts: string[] = [];
          if (typeof body.redisSaveError === "string")
            parts.push(`Snapshot not saved to Redis: ${body.redisSaveError} (full page reload will look empty).`);
          if (typeof body.profileUpsertError === "string" && body.profileUpsertError)
            parts.push(`Profile merge: ${body.profileUpsertError}`);
          setStripeWriteWarn(parts.length > 0 ? parts.join(" ") : null);
          flash("success", "Stripe users refreshed.");
        } else {
          setStripeWriteWarn(null);
        }
      } catch (e) {
        setStripeWriteWarn(null);
        const msg = e instanceof Error ? e.message : "fetch failed";
        setStripeError(msg);
        setStripePurchasers([]);
        if (live) flash("error", msg);
      } finally {
        setStripeLoading(false);
      }
    },
    [flash],
  );

  const copyStripeUserEmails = useCallback(async () => {
    const emails = stripePurchasers.map((row) => (row.email ?? "").trim()).filter(Boolean);
    if (emails.length === 0) return;
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      flash("success", "Stripe user emails copied.");
    } catch {
      flash("error", "Could not copy to clipboard.");
    }
  }, [stripePurchasers, flash]);

  useEffect(() => {
    void fetchStripePurchasers(false);
  }, [fetchStripePurchasers]);

  return (
      <section className="space-y-3" aria-labelledby="admin-stripe-users-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-stripe-users-heading" className="font-display text-xl font-semibold tracking-tight text-foreground">
            Stripe Users{" "}
            <span className="font-normal text-muted-foreground tabular-nums">({stripePurchasers.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={stripeLoading}
              onClick={() => void fetchStripePurchasers(true)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted/60 disabled:opacity-50"
              aria-label="Refresh Stripe users from upstream"
            >
              {stripeLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              disabled={stripeLoading || stripePurchasers.length === 0}
              onClick={() => void copyStripeUserEmails()}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted/60 disabled:opacity-50"
              aria-label="Copy Stripe user emails"
            >
              <Copy className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {stripeError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {stripeError}
          </p>
        ) : null}
        {stripeWriteWarn ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100" role="status">
            {stripeWriteWarn}
          </p>
        ) : null}

        {stripePurchasers.length === 0 && !stripeError && !stripeLoading ? (
          <p className="text-sm text-muted-foreground">
            No snapshot in Redis yet. Use the refresh control to pull from Stripe and write Redis (this page load only reads Redis).
          </p>
        ) : null}
        {stripePurchasers.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border dark:border-emerald-400/15 dark:shadow-[0_4px_24px_rgba(52,211,153,0.08)]">
            <table className="w-full min-w-[840px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 dark:bg-emerald-400/5 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-1.5">Email</th>
                  <th className="px-3 py-1.5">Plan</th>
                  <th className="px-3 py-1.5">Payment</th>
                  <th className="px-3 py-1.5">Amount</th>
                  <th className="px-3 py-1.5">Product</th>
                  <th className="px-3 py-1.5">Customer</th>
                  <th className="px-3 py-1.5">Session</th>
                  <th className="px-3 py-1.5">Checkout created</th>
                </tr>
              </thead>
              <tbody>
                {stripePurchasers.map((w) => (
                  <tr
                    key={`${w.email}:${w.waitlistPriceId}:${w.stripeSessionId}`}
                    className="border-b border-border/80 last:border-0 transition-colors duration-150 hover:bg-emerald-500/4 dark:hover:bg-emerald-400/6"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(w.email, 48)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{stripePlanLabel(w.priceRole)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{short(w.paymentStatus, 20)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs text-muted-foreground">
                      {w.amountTotal && w.amountTotal !== "0" ? formatStripeAmount(w.amountTotal, w.currency) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs" title={w.stripeProductId?.trim() || undefined}>
                      {(w.stripeProductId ?? "").trim() ? short(w.stripeProductId ?? "", 22) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">
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
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(w.stripeSessionId, 20)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs text-muted-foreground">{short(w.checkoutCreated, 24)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
  );
}

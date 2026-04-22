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

type SlackWorkspaceUserRow = {
  slackUserId: string;
  teamId: string;
  username: string;
  realName: string;
  displayName: string;
  email: string;
  isBot: boolean;
  isDeleted: boolean;
};

type SlackUsersPayload = {
  users?: SlackWorkspaceUserRow[];
  source?: string;
  fetchedAt?: string | null;
  snapshotNote?: string;
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

/** Stripe checkout customers + Slack workspace members (Redis hourly snapshots or live queries). */
export function UserProfilesPanel() {
  const [stripePurchasers, setStripePurchasers] = useState<StripeWaitlistPurchaserRow[]>([]);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

  const [slackUsers, setSlackUsers] = useState<SlackWorkspaceUserRow[]>([]);
  const [slackMeta, setSlackMeta] = useState<{ source?: string; fetchedAt?: string | null; snapshotNote?: string }>({});
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);

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

  const fetchSlackUsers = useCallback(async (live: boolean) => {
    setSlackLoading(true);
    setSlackError(null);
    try {
      const qs = live ? "?source=live" : "";
      const res = await fetch(`/api/admin/slack-workspace-users${qs}`, { cache: "no-store" });
      const body = (await res.json()) as SlackUsersPayload;
      if (!res.ok) {
        setSlackError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setSlackUsers([]);
        setSlackMeta({});
        return;
      }
      setSlackUsers(Array.isArray(body.users) ? body.users : []);
      setSlackMeta({ source: body.source, fetchedAt: body.fetchedAt ?? null, snapshotNote: body.snapshotNote });
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : "fetch failed");
      setSlackUsers([]);
      setSlackMeta({});
    } finally {
      setSlackLoading(false);
    }
  }, []);

  const refreshSlackSnapshot = useCallback(async () => {
    await fetchSlackUsers(false);
  }, [fetchSlackUsers]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    void refreshSlackSnapshot();
  }, [refreshSlackSnapshot]);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Stripe Users{" "}
          <span className="font-normal text-muted-foreground tabular-nums">({stripePurchasers.length})</span>
        </h2>
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

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Slack Users <span className="font-normal text-muted-foreground tabular-nums">({slackUsers.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void refreshSlackSnapshot()}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={slackLoading}
            onClick={() => void fetchSlackUsers(true)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
          >
            Query Slack live
          </button>
        </div>
      </div>

      {slackMeta.fetchedAt || slackMeta.snapshotNote ? (
        <p className="text-xs text-muted-foreground">
          {slackUsers.length} row{slackUsers.length === 1 ? "" : "s"}
          {slackMeta.source ? ` · source ${slackMeta.source}` : ""}
          {slackMeta.fetchedAt ? ` · last fetch ${slackMeta.fetchedAt}` : ""}
          {slackMeta.snapshotNote ? ` — ${slackMeta.snapshotNote}` : ""}
        </p>
      ) : null}

      {slackError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {slackError}
        </p>
      ) : null}

      <section className="space-y-3" aria-label="Slack users">
        {slackUsers.length === 0 && !slackError && !slackLoading ? (
          <p className="text-sm text-muted-foreground">
            No rows yet. Use Refresh or Query Slack live (set <span className="font-mono">SLACK_BOT_TOKEN</span> on the
            backend — same as slack-orchestrator; copy from <span className="font-mono">.env.dev</span> or{" "}
            <span className="font-mono">.env.prod</span> there).
          </p>
        ) : null}
        {slackUsers.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Slack ID</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Bot</th>
                  <th className="px-3 py-2">Deleted</th>
                </tr>
              </thead>
              <tbody>
                {slackUsers.map((u) => (
                  <tr key={u.slackUserId} className="border-b border-border/80 last:border-0">
                    <td className="px-3 py-2 text-xs">
                      {short((u.realName || u.displayName || u.username || "—").trim(), 40)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.email || "—", 48)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.username, 28)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.slackUserId, 16)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.teamId, 14)}</td>
                    <td className="px-3 py-2 text-xs">{u.isBot ? "yes" : "—"}</td>
                    <td className="px-3 py-2 text-xs">{u.isDeleted ? "yes" : "—"}</td>
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

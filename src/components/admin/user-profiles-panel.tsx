"use client";

import { useCallback, useEffect, useState } from "react";

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
};

type StripePurchasersPayload = {
  purchasers?: StripeWaitlistPurchaserRow[];
  error?: string;
  message?: string;
  redisSaveError?: string;
  profileUpsertError?: string;
};

type SlackWorkspaceUserRow = {
  slackUserId: string;
  teamId: string;
  username: string;
  realName: string;
  displayName: string;
  email: string;
  /** Slack profile image_* URL from users.list (HTTPS). */
  profileImageUrl?: string;
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
  redisSaveError?: string;
  syncError?: string;
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

/** Stripe checkout customers + Slack workspace members. Mount: in `next dev`, live-fetches Stripe + Slack (writes Redis) unless `NEXT_PUBLIC_ADMIN_SKIP_SNAPSHOT_WARM_ON_LOAD=1`. Production `next start` uses Redis snapshots only unless `NEXT_PUBLIC_ADMIN_WARM_STRIPE_SLACK_ON_LOAD=1`. Refresh always pulls live. */
export function UserProfilesPanel() {
  const [stripePurchasers, setStripePurchasers] = useState<StripeWaitlistPurchaserRow[]>([]);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeWriteWarn, setStripeWriteWarn] = useState<string | null>(null);

  const [slackUsers, setSlackUsers] = useState<SlackWorkspaceUserRow[]>([]);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackWriteWarn, setSlackWriteWarn] = useState<string | null>(null);

  const fetchStripePurchasers = useCallback(async (live: boolean) => {
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
        setStripeError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setStripePurchasers([]);
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
      } else {
        setStripeWriteWarn(null);
      }
    } catch (e) {
      setStripeWriteWarn(null);
      setStripeError(e instanceof Error ? e.message : "fetch failed");
      setStripePurchasers([]);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const fetchSlackUsers = useCallback(async (live: boolean) => {
    setSlackLoading(true);
    setSlackError(null);
    if (!live) setSlackWriteWarn(null);
    try {
      const qs = live ? "?source=live" : "";
      const res = await fetch(`/api/admin/slack-workspace-users${qs}`, { cache: "no-store" });
      if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
        return;
      }
      const body = (await res.json()) as SlackUsersPayload;
      if (!res.ok) {
        setSlackWriteWarn(null);
        setSlackError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setSlackUsers([]);
        return;
      }
      setSlackUsers(Array.isArray(body.users) ? body.users : []);
      if (live) {
        const parts: string[] = [];
        if (typeof body.redisSaveError === "string")
          parts.push(`Snapshot not saved to Redis: ${body.redisSaveError} (full page reload will look empty).`);
        if (typeof body.syncError === "string" && body.syncError)
          parts.push(`Slack→email index: ${body.syncError}`);
        setSlackWriteWarn(parts.length > 0 ? parts.join(" ") : null);
      } else {
        setSlackWriteWarn(null);
      }
    } catch (e) {
      setSlackWriteWarn(null);
      setSlackError(e instanceof Error ? e.message : "fetch failed");
      setSlackUsers([]);
    } finally {
      setSlackLoading(false);
    }
  }, []);

  useEffect(() => {
    const skip = process.env.NEXT_PUBLIC_ADMIN_SKIP_SNAPSHOT_WARM_ON_LOAD === "1";
    const explicitWarm = process.env.NEXT_PUBLIC_ADMIN_WARM_STRIPE_SLACK_ON_LOAD === "1";
    const devWarm =
      process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_ADMIN_WARM_STRIPE_SLACK_ON_LOAD !== "0";
    const warm = !skip && (explicitWarm || devWarm);
    if (warm) {
      void fetchStripePurchasers(true);
      void fetchSlackUsers(true);
    } else {
      void fetchStripePurchasers(false);
      void fetchSlackUsers(false);
    }
  }, [fetchStripePurchasers, fetchSlackUsers]);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          Stripe Users{" "}
          <span className="font-normal text-muted-foreground tabular-nums">({stripePurchasers.length})</span>
        </h2>
        <button
          type="button"
          disabled={stripeLoading}
          onClick={() => void fetchStripePurchasers(true)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          Refresh
        </button>
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

      <section className="space-y-3" aria-label="Stripe users">
        {stripePurchasers.length === 0 && !stripeError && !stripeLoading ? (
          <p className="text-sm text-muted-foreground">
            No snapshot in Redis yet. Use Refresh to pull from Stripe and write Redis (this page load only reads Redis).
          </p>
        ) : null}
        {stripePurchasers.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Product</th>
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
                    <td className="px-3 py-2 font-mono text-xs" title={w.stripeProductId?.trim() || undefined}>
                      {(w.stripeProductId ?? "").trim() ? short(w.stripeProductId ?? "", 22) : "—"}
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
        <button
          type="button"
          disabled={slackLoading}
          onClick={() => void fetchSlackUsers(true)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {slackError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {slackError}
        </p>
      ) : null}
      {slackWriteWarn ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100" role="status">
          {slackWriteWarn}
        </p>
      ) : null}

      <section className="space-y-3" aria-label="Slack users">
        {slackUsers.length === 0 && !slackError && !slackLoading ? (
          <p className="text-sm text-muted-foreground">
            No snapshot in Redis yet. Use Refresh to pull from Slack and write Redis (needs{" "}
            <span className="font-mono">SLACK_BOT_TOKEN</span> — same as slack-orchestrator; copy from{" "}
            <span className="font-mono">.env.dev</span> or <span className="font-mono">.env.prod</span> there). This page
            load only reads Redis.
          </p>
        ) : null}
        {slackUsers.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-12 px-2 py-2" scope="col">
                    <span className="sr-only">Photo</span>
                  </th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Slack ID</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Bot</th>
                  <th className="px-3 py-2">Deleted</th>
                </tr>
              </thead>
              <tbody>
                {slackUsers.map((u) => {
                  const display = (u.realName || u.displayName || u.username || "").trim();
                  const avatarSrc = (u.profileImageUrl ?? "").trim();
                  return (
                  <tr key={u.slackUserId} className="border-b border-border/80 last:border-0">
                    <td className="px-2 py-2 align-middle">
                      {avatarSrc ? (
                        <img
                          src={avatarSrc}
                          alt={display ? `${display} Slack profile` : "Slack profile"}
                          width={32}
                          height={32}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-border"
                        />
                      ) : (
                        <span
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-1 ring-border"
                          title="No image from Slack"
                          aria-hidden
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.email || "—", 48)}</td>
                    <td className="px-3 py-2 text-xs">{short(display || "—", 40)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.username, 28)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.slackUserId, 16)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{short(u.teamId, 14)}</td>
                    <td className="px-3 py-2 text-xs">{u.isBot ? "yes" : "—"}</td>
                    <td className="px-3 py-2 text-xs">{u.isDeleted ? "yes" : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

"use client";

import { Copy, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
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
  /** From Redis profile (Joanne #humans terms confirm). */
  terms?: string;
  termsMessageTs?: string;
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
  /** Count of isDeleted=true rows the backend filtered out (0 when includeDeleted=true). */
  deletedHidden?: number;
  includeDeleted?: boolean;
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

/** Slack workspace members (users.list). Mount reads Redis snapshots; live refresh pulls upstream and updates Redis. */
export function AdminSlackUsersTable() {
  const flash = useAdminFlashToast();
  const [slackUsers, setSlackUsers] = useState<SlackWorkspaceUserRow[]>([]);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackWriteWarn, setSlackWriteWarn] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedHidden, setDeletedHidden] = useState(0);

  const fetchSlackUsers = useCallback(
    async (live: boolean, includeDeleted: boolean) => {
      setSlackLoading(true);
      setSlackError(null);
      if (!live) setSlackWriteWarn(null);
      try {
        const params = new URLSearchParams();
        if (live) params.set("source", "live");
        if (includeDeleted) params.set("include_deleted", "true");
        const qs = params.toString();
        const res = await fetch(`/api/admin/slack-workspace-users${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
          return;
        }
        const body = (await res.json()) as SlackUsersPayload;
        if (!res.ok) {
          setSlackWriteWarn(null);
          const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
          setSlackError(msg);
          setSlackUsers([]);
          if (live) flash("error", msg);
          return;
        }
        setSlackUsers(Array.isArray(body.users) ? body.users : []);
        setDeletedHidden(typeof body.deletedHidden === "number" ? body.deletedHidden : 0);
        if (live) {
          const parts: string[] = [];
          if (typeof body.redisSaveError === "string")
            parts.push(`Snapshot not saved to Redis: ${body.redisSaveError} (full page reload will look empty).`);
          if (typeof body.syncError === "string" && body.syncError) parts.push(`Slack→email index: ${body.syncError}`);
          setSlackWriteWarn(parts.length > 0 ? parts.join(" ") : null);
          flash("success", "Slack users refreshed.");
        } else {
          setSlackWriteWarn(null);
        }
      } catch (e) {
        setSlackWriteWarn(null);
        const msg = e instanceof Error ? e.message : "fetch failed";
        setSlackError(msg);
        setSlackUsers([]);
        if (live) flash("error", msg);
      } finally {
        setSlackLoading(false);
      }
    },
    [flash],
  );

  const copySlackUserIds = useCallback(async () => {
    const ids = slackUsers.map((u) => (u.slackUserId ?? "").trim()).filter(Boolean);
    if (ids.length === 0) return;
    try {
      await navigator.clipboard.writeText(ids.join(", "));
      flash("success", "Slack user IDs copied.");
    } catch {
      flash("error", "Could not copy to clipboard.");
    }
  }, [slackUsers, flash]);

  useEffect(() => {
    void fetchSlackUsers(false, showDeleted);
  }, [fetchSlackUsers, showDeleted]);

  return (
      <section className="space-y-3" aria-labelledby="admin-slack-users-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-slack-users-heading" className="font-display text-xl font-semibold tracking-tight text-foreground">
            Slack Users <span className="font-normal text-muted-foreground tabular-nums">({slackUsers.length})</span>
            {!showDeleted && deletedHidden > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                ({deletedHidden} deleted hidden)
              </span>
            ) : null}
          </h2>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={showDeleted}
                disabled={slackLoading}
                onChange={(e) => setShowDeleted(e.target.checked)}
                className="size-3.5 rounded border-border"
              />
              Show deleted
            </label>
            <button
              type="button"
              disabled={slackLoading}
              onClick={() => void fetchSlackUsers(true, showDeleted)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted/60 disabled:opacity-50"
              aria-label="Refresh Slack workspace users from upstream"
            >
              {slackLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              disabled={slackLoading || slackUsers.length === 0}
              onClick={() => void copySlackUserIds()}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted/60 disabled:opacity-50"
              aria-label="Copy Slack user IDs"
            >
              <Copy className="size-4" aria-hidden />
            </button>
          </div>
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

        {slackUsers.length === 0 && !slackError && !slackLoading ? (
          <p className="text-sm text-muted-foreground">
            No snapshot in Redis yet. Use the refresh control to pull from Slack and write Redis (needs{" "}
            <span className="font-mono">ORCHESTRATOR_SLACK_BOT_TOKEN</span> — same as slack-orchestrator /
            agents-mcp-server; copy from <span className="font-mono">.env.dev</span> or{" "}
            <span className="font-mono">.env.prod</span> there; legacy{" "}
            <span className="font-mono">SLACK_BOT_TOKEN</span> still accepted). This page load only reads Redis.
          </p>
        ) : null}
        {slackUsers.length > 0 ? (
          <ul className="grid gap-2 sm:hidden" aria-label="Slack users (mobile)">
            {slackUsers.map((u) => {
              const display = (u.realName || u.displayName || u.username || "").trim();
              const avatarSrc = (u.profileImageUrl ?? "").trim();
              const initial = (display || u.username || "?").trim().charAt(0).toUpperCase();
              return (
                <li
                  key={u.slackUserId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
                >
                  {avatarSrc ? (
                    <Image
                      src={avatarSrc}
                      alt={display ? `${display} Slack profile` : "Slack profile"}
                      width={40}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-border"
                    />
                  ) : (
                    <span
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border"
                      aria-hidden
                    >
                      {initial}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{display || "—"}</span>
                      {u.isBot ? (
                        <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          bot
                        </span>
                      ) : null}
                      {u.isDeleted ? (
                        <span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          deleted
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{u.email || "—"}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {slackUsers.length > 0 ? (
          <div className="hidden overflow-x-auto rounded-xl border border-border dark:border-emerald-400/15 sm:block dark:shadow-[0_4px_24px_rgba(52,211,153,0.08)]">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 dark:bg-emerald-400/5 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-9 px-2 py-1.5" scope="col">
                    <span className="sr-only">Photo</span>
                  </th>
                  <th className="px-3 py-1.5">Email</th>
                  <th className="px-3 py-1.5">Name</th>
                  <th className="px-3 py-1.5">Username</th>
                  <th className="px-3 py-1.5">Slack ID</th>
                  <th className="px-3 py-1.5">Team</th>
                  <th className="px-3 py-1.5">Terms</th>
                  <th className="px-3 py-1.5">Bot</th>
                  <th className="px-3 py-1.5">Deleted</th>
                </tr>
              </thead>
              <tbody>
                {slackUsers.map((u) => {
                  const display = (u.realName || u.displayName || u.username || "").trim();
                  const avatarSrc = (u.profileImageUrl ?? "").trim();
                  return (
                  <tr key={u.slackUserId} className="border-b border-border/80 last:border-0 transition-colors duration-150 hover:bg-emerald-500/4 dark:hover:bg-emerald-400/6">
                    <td className="px-2 py-1.5 align-middle">
                      {avatarSrc ? (
                        <Image
                          src={avatarSrc}
                          alt={display ? `${display} Slack profile` : "Slack profile"}
                          width={20}
                          height={20}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-5 w-5 rounded-full object-cover ring-1 ring-border"
                        />
                      ) : (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground ring-1 ring-border"
                          title="No image from Slack"
                          aria-hidden
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.email || "—", 48)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{short(display || "—", 40)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.username, 28)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.slackUserId, 16)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.teamId, 14)}</td>
                    <td
                      className="whitespace-nowrap px-3 py-1.5 align-middle text-xs text-muted-foreground"
                      title={(u.termsMessageTs ?? "").trim() || undefined}
                    >
                      {(u.terms ?? "").trim() ? short(u.terms ?? "", 22) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{u.isBot ? "yes" : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{u.isDeleted ? "yes" : "—"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
  );
}

type UserProfileRow = {
  email: string;
  attributedTo?: string;
  tier?: string;
  slackUserId?: string;
  linked?: boolean;
  profileUpdatedAt?: string;
};

type UserProfilesPayload = {
  profiles?: UserProfileRow[];
  error?: string;
};

export function AdminUserProfilesTable() {
  const [profiles, setProfiles] = useState<UserProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flash = useAdminFlashToast();

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-profiles", { cache: "no-store" });
      if (res.status === 401) { kickToLoginForUnauthorizedApi(res.status, "admin"); return; }
      const body = (await res.json()) as UserProfilesPayload;
      if (!res.ok || body.error) {
        setError(body.error ?? "Failed to load profiles");
        return;
      }
      setProfiles(body.profiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchProfiles(); }, [fetchProfiles]);

  const attributed = profiles.filter((p) => p.attributedTo);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Sales Attribution</h2>
        <button
          type="button"
          onClick={() => void fetchProfiles()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </button>
        {attributed.length > 0 && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {attributed.length} attributed
          </span>
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && profiles.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No profiles yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Ref / attributed to</th>
                <th className="px-3 py-2 text-left font-medium">Tier</th>
                <th className="px-3 py-2 text-left font-medium">Linked</th>
                <th className="px-3 py-2 text-left font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr
                  key={p.email}
                  className="border-b border-border/80 last:border-0 transition-colors hover:bg-muted/30"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{short(p.email, 48)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                    {p.attributedTo ? (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        {p.attributedTo}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{p.tier || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">{p.linked ? "✓" : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                    {p.profileUpdatedAt ? short(p.profileUpdatedAt, 19) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

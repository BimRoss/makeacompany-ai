"use client";

import { ChevronDown, ChevronsUpDown, ChevronUp, Copy, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useState } from "react";

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

type LifecycleStatus = "free_lifetime" | "trialing" | "active" | "expired";

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
  /** From Redis profile via EffectiveStatus (#245). */
  status?: LifecycleStatus | string;
  /** Unix-seconds trial deadline, only present when status=trialing. */
  trialExpiresAt?: number;
  /** Mirrored from profile so active rows can deep-link to the Stripe dashboard. */
  stripeCustomerId?: string;
};

type StatusFilter = "all" | LifecycleStatus | "trialing_lt_48h";

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All statuses",
  free_lifetime: "Free lifetime",
  trialing: "Trialing",
  active: "Active",
  expired: "Expired",
  trialing_lt_48h: "Trialing <48h",
};

const STATUS_PILL_CLASSES: Record<LifecycleStatus, string> = {
  free_lifetime: "bg-muted text-muted-foreground ring-1 ring-border",
  trialing: "bg-blue-500/15 text-blue-700 ring-1 ring-blue-500/30 dark:text-blue-300",
  active: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300",
  expired: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300",
};

function formatRelativeFromNow(unixSeconds: number, nowSeconds: number): string {
  const deltaSec = unixSeconds - nowSeconds;
  const abs = Math.abs(deltaSec);
  const past = deltaSec < 0;
  const day = 86400;
  const hour = 3600;
  const minute = 60;
  let body: string;
  if (abs >= day) body = `${Math.round(abs / day)}d`;
  else if (abs >= hour) body = `${Math.round(abs / hour)}h`;
  else if (abs >= minute) body = `${Math.round(abs / minute)}m`;
  else body = `${abs}s`;
  return past ? `${body} ago` : `in ${body}`;
}

function stripeCustomerDashboardUrl(customerId: string): string {
  return `https://dashboard.stripe.com/customers/${encodeURIComponent(customerId)}`;
}

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

type SlackSortKey =
  | "email"
  | "name"
  | "status"
  | "trialEnds"
  | "messages"
  | "username"
  | "slackId"
  | "team"
  | "bot";

type EngagementDayBin = { day: string; messages: number };
type EngagementSummary = {
  slack_user_id: string;
  total_messages: number;
  ross_messages: number;
  joanne_messages: number;
  ross_mentions: number;
  joanne_mentions: number;
  first_seen_at?: string;
  last_seen_at?: string;
  sparkline: EngagementDayBin[];
};
type EngagementTopResponse = { users?: EngagementSummary[]; error?: string };
type EngagementMap = Record<string, number>;

type SlackSortDir = "asc" | "desc";

// Status priority for sort: trialing-with-deadline-soonest first, then
// active, free_lifetime, expired. Other strings fall through to the end.
const STATUS_SORT_RANK: Record<string, number> = {
  trialing: 0,
  active: 1,
  free_lifetime: 2,
  expired: 3,
};

function getSlackSortValue(
  u: SlackWorkspaceUserRow,
  key: SlackSortKey,
  engagement: EngagementMap,
): string | number | null {
  switch (key) {
    case "email":
      return (u.email ?? "").toLowerCase();
    case "name":
      return (u.realName || u.displayName || u.username || "").toLowerCase();
    case "status": {
      const s = (u.status ?? "").toString();
      const rank = STATUS_SORT_RANK[s];
      return typeof rank === "number" ? rank : 99;
    }
    case "trialEnds":
      return typeof u.trialExpiresAt === "number" && u.trialExpiresAt > 0 ? u.trialExpiresAt : null;
    case "messages": {
      const n = engagement[u.slackUserId];
      return typeof n === "number" ? n : 0;
    }
    case "username":
      return (u.username ?? "").toLowerCase();
    case "slackId":
      return u.slackUserId ?? "";
    case "team":
      return u.teamId ?? "";
    case "bot":
      return u.isBot ? 1 : 0;
  }
}

function compareSlackUsers(
  a: SlackWorkspaceUserRow,
  b: SlackWorkspaceUserRow,
  key: SlackSortKey,
  dir: SlackSortDir,
  engagement: EngagementMap,
): number {
  const av = getSlackSortValue(a, key, engagement);
  const bv = getSlackSortValue(b, key, engagement);
  // Nulls (e.g. trialEnds when not trialing) always sort to the end,
  // regardless of direction — they're "no value", not "small value".
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv));
  }
  return dir === "asc" ? cmp : -cmp;
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  sortKey: SlackSortKey;
  active: boolean;
  dir: SlackSortDir;
  onClick: (key: SlackSortKey) => void;
  className?: string;
}) {
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : "none";
  const Icon = active ? (dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-1.5 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 rounded text-left uppercase tracking-wide transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <span>{label}</span>
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-50"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

function EngagementSparkline({ bins }: { bins: EngagementDayBin[] }) {
  if (!bins || bins.length === 0) {
    return <span className="text-xs text-muted-foreground">No activity in the last 30 days.</span>;
  }
  const w = 360;
  const h = 56;
  const max = Math.max(1, ...bins.map((b) => b.messages));
  const dx = bins.length > 1 ? w / (bins.length - 1) : 0;
  // Two-decimal precision keeps the SVG payload tight without visible jitter.
  const points = bins
    .map((b, i) => `${(i * dx).toFixed(2)},${(h - (b.messages / max) * (h - 4) - 2).toFixed(2)}`)
    .join(" ");
  const lastIdx = bins.length - 1;
  const lastX = (lastIdx * dx).toFixed(2);
  const lastY = (h - (bins[lastIdx].messages / max) * (h - 4) - 2).toFixed(2);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label={`Messages per day, last ${bins.length} days. Max ${max}.`}
      className="text-emerald-500"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" />
    </svg>
  );
}

function EngagementDetailPanel({
  slackUserId,
  detail,
  loading,
  error,
}: {
  slackUserId: string;
  detail: EngagementSummary | undefined;
  loading: boolean;
  error: string | undefined;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading engagement…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive" role="alert">
        Could not load engagement for {slackUserId}: {error}
      </p>
    );
  }
  if (!detail) {
    return <p className="text-xs text-muted-foreground">No engagement data.</p>;
  }
  const lastSeen = (detail.last_seen_at ?? "").trim();
  const firstSeen = (detail.first_seen_at ?? "").trim();
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Total messages</dt>
        <dd className="tabular-nums font-medium text-foreground">{detail.total_messages.toLocaleString()}</dd>
        <dt className="text-muted-foreground">To Ross</dt>
        <dd className="tabular-nums">
          {detail.ross_messages.toLocaleString()}
          {detail.ross_mentions > 0 ? (
            <span className="ml-1 text-muted-foreground">({detail.ross_mentions.toLocaleString()} @-mentions)</span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">To Joanne</dt>
        <dd className="tabular-nums">
          {detail.joanne_messages.toLocaleString()}
          {detail.joanne_mentions > 0 ? (
            <span className="ml-1 text-muted-foreground">({detail.joanne_mentions.toLocaleString()} @-mentions)</span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">First seen</dt>
        <dd className="tabular-nums">{firstSeen || "—"}</dd>
        <dt className="text-muted-foreground">Last seen</dt>
        <dd className="tabular-nums">{lastSeen || "—"}</dd>
      </dl>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Messages per day, last 30 days</div>
        <EngagementSparkline bins={detail.sparkline} />
      </div>
    </div>
  );
}

function renderStatusCell(u: SlackWorkspaceUserRow) {
  const status = (u.status ?? "") as LifecycleStatus | "";
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pill = STATUS_PILL_CLASSES[status as LifecycleStatus];
  const pillClass = pill ?? "bg-muted text-muted-foreground ring-1 ring-border";
  const label = status.replace("_", " ");
  const customerId = (u.stripeCustomerId ?? "").trim();
  const pillBody = (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillClass}`}
    >
      {label}
    </span>
  );
  if (status === "active" && customerId) {
    return (
      <a
        href={stripeCustomerDashboardUrl(customerId)}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-fit"
        title={`Open ${customerId} in Stripe dashboard`}
      >
        {pillBody}
      </a>
    );
  }
  return pillBody;
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SlackSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SlackSortDir>("asc");
  // Engagement counters power the sortable Messages column and the
  // expandable row's stats card. We fetch the top-N on mount; the map is
  // keyed by slackUserId and stores total_messages for the column. The
  // detail (per-bot counters + sparkline) is lazy-loaded per expanded row.
  const [engagement, setEngagement] = useState<EngagementMap>({});
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [engagementDetail, setEngagementDetail] = useState<Record<string, EngagementSummary | undefined>>({});
  const [engagementDetailLoading, setEngagementDetailLoading] = useState<Record<string, boolean | undefined>>({});
  const [engagementDetailError, setEngagementDetailError] = useState<Record<string, string | undefined>>({});
  const handleSortClick = useCallback((key: SlackSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);
  // Re-render the relative-time column every minute so "ends in 3d" stays accurate without a refetch.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const fetchEngagementTop = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/user-engagement/top?limit=500", { cache: "no-store" });
      if (kickToLoginForUnauthorizedApi(res.status, "admin")) return;
      const body = (await res.json().catch(() => null)) as EngagementTopResponse | null;
      if (!res.ok || !body || !Array.isArray(body.users)) {
        return;
      }
      const next: EngagementMap = {};
      for (const u of body.users) {
        if (u.slack_user_id) next[u.slack_user_id] = u.total_messages || 0;
      }
      setEngagement(next);
    } catch {
      // Silent: engagement is a soft signal on the admin page. A failure
      // leaves the Messages column showing 0s, which is correct enough
      // until the next refresh.
    }
  }, []);

  const loadEngagementDetail = useCallback(async (slackUserId: string) => {
    if (!slackUserId) return;
    setEngagementDetailLoading((m) => ({ ...m, [slackUserId]: true }));
    setEngagementDetailError((m) => ({ ...m, [slackUserId]: undefined }));
    try {
      const res = await fetch(`/api/admin/user-engagement/${encodeURIComponent(slackUserId)}`, { cache: "no-store" });
      if (kickToLoginForUnauthorizedApi(res.status, "admin")) return;
      const body = (await res.json().catch(() => null)) as EngagementSummary | { error?: string } | null;
      if (!res.ok || !body) {
        const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        setEngagementDetailError((m) => ({ ...m, [slackUserId]: msg }));
        return;
      }
      const summary = body as EngagementSummary;
      setEngagementDetail((m) => ({ ...m, [slackUserId]: summary }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      setEngagementDetailError((m) => ({ ...m, [slackUserId]: msg }));
    } finally {
      setEngagementDetailLoading((m) => ({ ...m, [slackUserId]: false }));
    }
  }, []);

  const toggleExpanded = useCallback(
    (slackUserId: string) => {
      setExpandedUserId((prev) => {
        const next = prev === slackUserId ? null : slackUserId;
        if (next && !engagementDetail[next]) {
          void loadEngagementDetail(next);
        }
        return next;
      });
    },
    [engagementDetail, loadEngagementDetail],
  );

  useEffect(() => {
    void fetchSlackUsers(false, showDeleted);
  }, [fetchSlackUsers, showDeleted]);

  useEffect(() => {
    void fetchEngagementTop();
  }, [fetchEngagementTop]);

  const visibleSlackUsers = slackUsers.filter((u) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "trialing_lt_48h") {
      if (u.status !== "trialing") return false;
      const exp = typeof u.trialExpiresAt === "number" ? u.trialExpiresAt : 0;
      if (exp <= 0) return false;
      return exp - nowSeconds < 48 * 3600;
    }
    return u.status === statusFilter;
  });

  const sortedSlackUsers = sortKey
    ? [...visibleSlackUsers].sort((a, b) => compareSlackUsers(a, b, sortKey, sortDir, engagement))
    : visibleSlackUsers;

  return (
      <section className="space-y-3" aria-labelledby="admin-slack-users-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-slack-users-heading" className="font-display text-xl font-semibold tracking-tight text-foreground">
            Slack Users{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({visibleSlackUsers.length}
              {statusFilter !== "all" && visibleSlackUsers.length !== slackUsers.length
                ? ` of ${slackUsers.length}`
                : ""}
              )
            </span>
            {!showDeleted && deletedHidden > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                ({deletedHidden} deleted hidden)
              </span>
            ) : null}
          </h2>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground select-none">
              <span className="sr-only">Filter by lifecycle status</span>
              <select
                value={statusFilter}
                disabled={slackLoading}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground disabled:opacity-50"
                aria-label="Filter Slack users by status"
              >
                {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_FILTER_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
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
        {visibleSlackUsers.length > 0 ? (
          <ul className="grid gap-2 sm:hidden" aria-label="Slack users (mobile)">
            {sortedSlackUsers.map((u) => {
              const display = (u.realName || u.displayName || u.username || "").trim();
              const avatarSrc = (u.profileImageUrl ?? "").trim();
              const initial = (display || u.username || "?").trim().charAt(0).toUpperCase();
              const trialCountdown =
                u.status === "trialing" && typeof u.trialExpiresAt === "number" && u.trialExpiresAt > 0
                  ? formatRelativeFromNow(u.trialExpiresAt, nowSeconds)
                  : null;
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
                    {u.status ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {renderStatusCell(u)}
                        {trialCountdown ? (
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            ends {trialCountdown}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {visibleSlackUsers.length > 0 ? (
          <div className="hidden overflow-x-auto rounded-xl border border-border dark:border-emerald-400/15 sm:block dark:shadow-[0_4px_24px_rgba(52,211,153,0.08)]">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 dark:bg-emerald-400/5 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-12 px-2 py-1.5" scope="col">
                    <span className="sr-only">Photo</span>
                  </th>
                  {(
                    [
                      ["email", "Email"],
                      ["name", "Name"],
                      ["status", "Status"],
                      ["trialEnds", "Trial ends"],
                      ["messages", "Messages"],
                      ["username", "Username"],
                      ["slackId", "Slack ID"],
                      ["team", "Team"],
                      ["bot", "Bot"],
                    ] as Array<[SlackSortKey, string]>
                  ).map(([key, label]) => (
                    <SortableTh
                      key={key}
                      label={label}
                      sortKey={key}
                      active={sortKey === key}
                      dir={sortDir}
                      onClick={handleSortClick}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedSlackUsers.map((u) => {
                  const display = (u.realName || u.displayName || u.username || "").trim();
                  const avatarSrc = (u.profileImageUrl ?? "").trim();
                  const isExpanded = expandedUserId === u.slackUserId;
                  const totalMessages = engagement[u.slackUserId] ?? 0;
                  return (
                  <Fragment key={u.slackUserId}>
                  <tr
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(u.slackUserId)}
                    className="border-b border-border/80 last:border-0 cursor-pointer transition-colors duration-150 hover:bg-emerald-500/4 dark:hover:bg-emerald-400/6"
                  >
                    <td className="px-2 py-1.5 align-middle">
                      {avatarSrc ? (
                        <Image
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-1 ring-border"
                          title="No image from Slack"
                          aria-hidden
                        >
                          {(display || u.username || "?").trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.email || "—", 48)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{short(display || "—", 40)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">
                      {renderStatusCell(u)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs text-muted-foreground">
                      {u.status === "trialing" && typeof u.trialExpiresAt === "number" && u.trialExpiresAt > 0
                        ? formatRelativeFromNow(u.trialExpiresAt, nowSeconds)
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs tabular-nums">
                      {totalMessages > 0 ? totalMessages.toLocaleString() : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.username, 28)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.slackUserId, 16)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle font-mono text-xs">{short(u.teamId, 14)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 align-middle text-xs">{u.isBot ? "yes" : "—"}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-muted/40 dark:bg-emerald-400/5">
                      <td colSpan={10} className="px-4 py-3">
                        <EngagementDetailPanel
                          slackUserId={u.slackUserId}
                          detail={engagementDetail[u.slackUserId]}
                          loading={engagementDetailLoading[u.slackUserId] === true}
                          error={engagementDetailError[u.slackUserId]}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
  );
}


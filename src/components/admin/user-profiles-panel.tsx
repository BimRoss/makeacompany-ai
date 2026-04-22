"use client";

import { useCallback, useEffect, useState } from "react";

export type UserProfileRow = {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeSubscriptionStatus: string;
  stripePriceId: string;
  stripeSessionId: string;
  tier: string;
  slackUserId: string;
  waitlistPaymentStatus: string;
  profileUpdatedAt: string;
  slackProfileUpdatedAt: string;
  stripeSubscriptionUpdatedAt: string;
  linked: boolean;
};

type Payload = {
  profiles?: UserProfileRow[];
  limit?: number;
  error?: string;
};

function short(s: string, max: number) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t || "—";
  return `${t.slice(0, max - 1)}…`;
}

/** Combined Redis user profiles; checkmark when Slack + Stripe IDs are both set. */
export function UserProfilesPanel() {
  const [profiles, setProfiles] = useState<UserProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [cap, setCap] = useState<number | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-profiles", { cache: "no-store" });
      const body = (await res.json()) as Payload & { message?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setProfiles([]);
        return;
      }
      setProfiles(Array.isArray(body.profiles) ? body.profiles : []);
      setCap(typeof body.limit === "number" ? body.limit : null);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">User profiles</h2>
        <div className="flex flex-wrap items-center gap-3">
          {lastFetch ? (
            <p className="text-xs text-muted-foreground">
              {profiles.length} row{profiles.length === 1 ? "" : "s"}
              {cap != null ? ` (cap ${cap})` : ""}
              {loading ? " · updating…" : ""} · last fetch {lastFetch.toLocaleTimeString()}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchProfiles()}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Redis hashes keyed by email (Stripe + Slack). A checkmark means both <code className="text-xs">stripeCustomerId</code> and{" "}
        <code className="text-xs">slackUserId</code> are present.
      </p>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {profiles.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No profile rows yet. Waitlist checkouts and subscription webhooks populate this table.</p>
      ) : null}

      {profiles.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-2 py-2 text-center" aria-label="Linked" />
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Slack user</th>
                <th className="px-3 py-2">Stripe customer</th>
                <th className="px-3 py-2">Subscription</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.email} className="border-b border-border/80 last:border-0">
                  <td className="px-2 py-2 text-center text-base" title={p.linked ? "Stripe + Slack linked" : "Missing Slack or Stripe id"}>
                    {p.linked ? "✓" : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{short(p.email, 48)}</td>
                  <td className="px-3 py-2">{short(p.tier, 24)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{short(p.slackUserId, 16)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{short(p.stripeCustomerId, 20)}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground">{short(p.stripeSubscriptionStatus, 16)}</span>
                    {p.stripePriceId ? (
                      <div className="font-mono text-[11px] text-muted-foreground">{short(p.stripePriceId, 28)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{short(p.profileUpdatedAt, 24)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

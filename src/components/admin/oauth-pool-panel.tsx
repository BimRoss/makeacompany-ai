"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

// OAuthPoolPanel surfaces combined-pool + per-agent draw against the
// CLAUDE_CODE_OAUTH_TOKEN pool. The story Grant wants on /admin: at a
// glance see (a) how much of the combined Ross+Joanne pool is left, and
// (b) which agent is driving the usage. Both bars share the same 0..pool
// axis so the per-agent draws stack visually to the pool total.

type SlotSnapshot = {
  slot: string;
  spawns_total: number;
  spawns_in_window: number;
  last_spawn_at?: string;
  rate_limit_errs_total: number;
  last_rate_limit_err_at?: string;
  last_rate_limit_err_excerpt?: string;
};

type AgentSnapshot = {
  window_seconds: number;
  slot_cap_per_window?: number;
  now: string;
  slots: SlotSnapshot[];
};

type AgentResult = {
  agent: string;
  url: string;
  ok: boolean;
  error?: string;
  snapshot?: AgentSnapshot;
};

type Payload = {
  agents: AgentResult[];
  checked_at: string;
};

// Go marshals zero-valued time.Time as "0001-01-01T00:00:00Z". omitempty
// doesn't catch it (time.Time isn't a recognized "empty" by encoding/json),
// so the backend leaks it. Guard here until we change the wire type to a
// pointer in oauth_pool_stats.go.
function isZeroTime(iso?: string): boolean {
  return !iso || iso.startsWith("0001-01-01");
}

function relativeTime(iso?: string): string {
  if (isZeroTime(iso)) return "—";
  const then = new Date(iso as string).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

export function OAuthPoolPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/oauth-pool", { cache: "no-store" });
      if (kickToLoginForUnauthorizedApi(response.status, "admin")) {
        return;
      }
      if (!response.ok) {
        setError(response.status === 401 ? "sign in to view" : `HTTP ${response.status}`);
        return;
      }
      const payload = (await response.json()) as Payload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3 px-0.5">
        <h2 className="font-display text-lg font-semibold tracking-tight">Rate-limit headroom</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          )}
          <span>Refresh</span>
        </button>
      </header>

      {error ? (
        <div className="rounded-lg border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-3 py-2 text-xs text-[var(--chart-neg)]">
          {error}
        </div>
      ) : null}

      {data ? (
        <PoolCard agents={data.agents} />
      ) : !loading ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : null}
    </section>
  );
}

// Fallback cap if the agent snapshot doesn't carry one (older Ross/Joanne
// builds before the slot_cap_per_window field shipped). Matches the
// constant in oauth_pool_stats.go on both Go sides.
const FALLBACK_SLOT_CAP_PER_WINDOW = 900;

type AgentRollup = {
  agent: string;
  ok: boolean;
  error?: string;
  spawnsInWindow: number;
  agentCap: number;
  rateLimitErrs: number;
  lastRateLimitAt?: string;
  lastRateLimitExcerpt?: string;
  slots: SlotSnapshot[];
  windowSeconds: number;
};

function rollup(agent: AgentResult): AgentRollup {
  const slots = agent.snapshot?.slots ?? [];
  const slotCap = agent.snapshot?.slot_cap_per_window || FALLBACK_SLOT_CAP_PER_WINDOW;
  let spawnsInWindow = 0;
  let rateLimitErrs = 0;
  let lastRateLimitAt: string | undefined;
  let lastRateLimitExcerpt: string | undefined;
  for (const s of slots) {
    spawnsInWindow += s.spawns_in_window;
    rateLimitErrs += s.rate_limit_errs_total;
    if (!isZeroTime(s.last_rate_limit_err_at)) {
      if (!lastRateLimitAt || (s.last_rate_limit_err_at as string) > lastRateLimitAt) {
        lastRateLimitAt = s.last_rate_limit_err_at;
        lastRateLimitExcerpt = s.last_rate_limit_err_excerpt;
      }
    }
  }
  return {
    agent: agent.agent,
    ok: agent.ok,
    error: agent.error,
    spawnsInWindow,
    agentCap: Math.max(1, slots.length) * slotCap,
    rateLimitErrs,
    lastRateLimitAt,
    lastRateLimitExcerpt,
    slots,
    windowSeconds: agent.snapshot?.window_seconds ?? 18000,
  };
}

function PoolCard({ agents }: { agents: AgentResult[] }) {
  const rollups = agents.map(rollup);
  const poolUsed = rollups.reduce((acc, r) => acc + r.spawnsInWindow, 0);
  // Pool cap is the SHARED Claude-OAuth pool, not the sum of per-agent
  // capacities — every agent (Ross + Joanne + personal agents) draws from
  // the same N tokens. Take max(agentCap) so the denominator equals
  // (distinct_tokens × slot_cap), which is what the rate limit actually
  // enforces. Older summed-cap math double-counted shared tokens and
  // inflated the denominator (1800 + 900 = 2700 when the real cap is 1800).
  const poolCap =
    rollups.reduce((acc, r) => Math.max(acc, r.agentCap), 0) ||
    FALLBACK_SLOT_CAP_PER_WINDOW;
  const poolPct = poolCap > 0 ? Math.min(1, poolUsed / poolCap) : 0;
  const windowHours = Math.round((rollups[0]?.windowSeconds ?? 18000) / 3600);
  const maxSlots = rollups.reduce((acc, r) => Math.max(acc, r.slots.length), 0);
  const slotCapForLabel =
    maxSlots > 0 ? Math.round(poolCap / maxSlots) : FALLBACK_SLOT_CAP_PER_WINDOW;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">
            pool
          </span>
          <span className="text-[10px] text-muted-foreground">
            {windowHours}h window · cap ~{slotCapForLabel} per slot · {rollups.length} agent
            {rollups.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="font-display text-sm font-semibold tabular-nums leading-none text-foreground">
          {Math.round(poolPct * 100)}%
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {poolUsed} / {poolCap}
          </span>
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <PoolStackedBar rollups={rollups} poolCap={poolCap} />
        <div className="space-y-2 pt-1">
          {rollups.map((r, i) => (
            <AgentBar key={r.agent} rollup={r} poolCap={poolCap} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Two ramps so the two agent segments stay visually distinct in both the
// stacked pool bar and the per-agent rows. Both ride the foreground color
// so the card stays in the same grey palette the rest of /admin uses.
function agentShade(index: number, pct: number): string {
  const base = index === 0 ? 35 : 20;
  return `color-mix(in oklab, var(--foreground) ${Math.round(base + pct * 55)}%, transparent)`;
}

function PoolStackedBar({
  rollups,
  poolCap,
}: {
  rollups: AgentRollup[];
  poolCap: number;
}) {
  const totalUsed = rollups.reduce((acc, r) => acc + r.spawnsInWindow, 0);
  const usedFraction = poolCap > 0 ? Math.min(1, totalUsed / poolCap) : 0;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[10px] text-muted-foreground">
        <span>combined pool</span>
        <span className="tabular-nums">
          {poolCap - totalUsed} left of {poolCap}
        </span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {rollups.map((r, i) => {
          const segPct = poolCap > 0 ? Math.min(1, r.spawnsInWindow / poolCap) : 0;
          if (segPct <= 0) return null;
          return (
            <div
              key={r.agent}
              className="h-full transition-all duration-300"
              style={{
                width: `${segPct * 100}%`,
                backgroundColor: agentShade(i, usedFraction),
              }}
              title={`${r.agent}: ${r.spawnsInWindow} / ${poolCap}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {rollups.map((r, i) => (
          <span key={r.agent} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: agentShade(i, usedFraction) }}
            />
            <span className="font-mono lowercase text-foreground/80">{r.agent}</span>
            <span className="tabular-nums">{r.spawnsInWindow}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentBar({
  rollup: r,
  poolCap,
  index,
}: {
  rollup: AgentRollup;
  poolCap: number;
  index: number;
}) {
  const pct = poolCap > 0 ? Math.min(1, r.spawnsInWindow / poolCap) : 0;
  const ownPct = r.agentCap > 0 ? Math.min(1, r.spawnsInWindow / r.agentCap) : 0;
  const fillColor = agentShade(index, ownPct);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-foreground/80">{r.agent}</span>
          {!r.ok ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--chart-neg)]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              unreachable
            </span>
          ) : null}
        </div>
        <span
          className="font-display text-sm font-semibold tabular-nums leading-none"
          style={{
            color: `color-mix(in oklab, var(--foreground) ${Math.round(55 + ownPct * 45)}%, transparent)`,
          }}
        >
          {Math.round(ownPct * 100)}%
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {r.spawnsInWindow} / {r.agentCap}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.max(r.spawnsInWindow > 0 ? 2 : 0, pct * 100)}%`,
            backgroundColor: fillColor,
          }}
          title={`${r.agent}: ${r.spawnsInWindow} of pool ${poolCap}`}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {r.ok && r.slots.length > 0
            ? `${r.slots.length} slot${r.slots.length === 1 ? "" : "s"} · last spawn ${relativeTime(
                latestSpawn(r.slots),
              )}`
            : r.error
              ? r.error
              : "no spawns observed yet"}
        </span>
        <span
          className={
            r.rateLimitErrs > 0
              ? "inline-flex items-center gap-1 font-medium text-foreground/70"
              : ""
          }
          title={r.lastRateLimitExcerpt ?? ""}
        >
          {r.rateLimitErrs > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {r.rateLimitErrs} 429
              {!isZeroTime(r.lastRateLimitAt)
                ? `, last ${relativeTime(r.lastRateLimitAt)}`
                : ""}
            </>
          ) : (
            "no 429s"
          )}
        </span>
      </div>
    </div>
  );
}

function latestSpawn(slots: SlotSnapshot[]): string | undefined {
  let latest: string | undefined;
  for (const s of slots) {
    if (isZeroTime(s.last_spawn_at)) continue;
    if (!latest || (s.last_spawn_at as string) > latest) {
      latest = s.last_spawn_at;
    }
  }
  return latest;
}

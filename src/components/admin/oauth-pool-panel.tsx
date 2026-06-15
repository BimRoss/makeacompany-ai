"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

// OAuthPoolPanel surfaces per-agent, per-slot usage of the
// CLAUDE_CODE_OAUTH_TOKEN pool so we can see at a glance whether
// round-robin is balancing across the two Max accounts and whether either
// slot just hit its 5h cap. Data comes from /api/admin/oauth-pool which
// fans out to ross + joanne admin endpoints.

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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(data?.agents ?? []).map((agent) => (
          <AgentCard key={agent.agent} agent={agent} />
        ))}
        {!data && !loading ? (
          <p className="text-xs text-muted-foreground">No data yet.</p>
        ) : null}
      </div>
    </section>
  );
}

// Fallback cap if the agent snapshot doesn't carry one (older Ross/Joanne
// builds before the slot_cap_per_window field shipped). Matches the
// constant in oauth_pool_stats.go on both Go sides.
const FALLBACK_SLOT_CAP_PER_WINDOW = 900;

function AgentCard({ agent }: { agent: AgentResult }) {
  const slots = agent.snapshot?.slots ?? [];
  const windowHours = agent.snapshot ? Math.round(agent.snapshot.window_seconds / 3600) : 5;
  const cap = agent.snapshot?.slot_cap_per_window || FALLBACK_SLOT_CAP_PER_WINDOW;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">
            {agent.agent}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {windowHours}h window · cap ~{cap}
          </span>
          {!agent.ok ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--chart-neg)]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              unreachable
            </span>
          ) : null}
        </div>
      </div>

      {agent.ok && slots.length > 0 ? (
        <div className="divide-y divide-border">
          {slots.map((slot) => (
            <SlotRow key={slot.slot} slot={slot} cap={cap} />
          ))}
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          {agent.error ? agent.error : "no spawns observed yet"}
        </div>
      )}
    </div>
  );
}

function SlotRow({ slot, cap }: { slot: SlotSnapshot; cap: number }) {
  // Real % of the published Max-20x cap from the agent snapshot. Token-
  // based cap is lower in practice for Opus + long context, but anchoring
  // to Anthropic's published floor is more useful than a peer-relative
  // gauge — at 60% the bar means we're actually at ~60% of the floor,
  // and a 429 here recalibrates the cap downward.
  const pct = cap > 0 ? Math.min(1, slot.spawns_in_window / cap) : 0;
  const pctLabel = Math.round(pct * 100);
  // Single grey ramp that darkens as we climb toward the cap. No red /
  // green / yellow tone breaks — 13/900 should not panic-flag.
  const barColor = `color-mix(in oklab, var(--foreground) ${Math.round(20 + pct * 70)}%, transparent)`;
  const textColor = `color-mix(in oklab, var(--foreground) ${Math.round(50 + pct * 50)}%, transparent)`;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{slot.slot}</span>
        <span
          className="font-display text-lg font-semibold tabular-nums leading-none"
          style={{ color: textColor }}
        >
          {pctLabel}%
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {slot.spawns_in_window} / {cap}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.max(2, pct * 100)}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>last spawn {relativeTime(slot.last_spawn_at)}</span>
        <span
          className={
            slot.rate_limit_errs_total > 0
              ? "inline-flex items-center gap-1 font-medium text-foreground/70"
              : ""
          }
          title={slot.last_rate_limit_err_excerpt ?? ""}
        >
          {slot.rate_limit_errs_total > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {slot.rate_limit_errs_total} 429
              {!isZeroTime(slot.last_rate_limit_err_at)
                ? `, last ${relativeTime(slot.last_rate_limit_err_at)}`
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

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

function isRecent(iso: string | undefined, withinSec: number): boolean {
  if (isZeroTime(iso)) return false;
  const then = new Date(iso as string).getTime();
  if (Number.isNaN(then)) return false;
  return (Date.now() - then) / 1000 < withinSec;
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
        <div className="space-y-0.5">
          <h2 className="font-display text-lg font-semibold tracking-tight">OAuth pool usage</h2>
          <p className="text-xs text-muted-foreground">
            Per-slot spawn counts and rate-limit hits across Ross + Joanne. In-memory; resets on pod restart.
          </p>
        </div>
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

      <div className="space-y-4">
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

function AgentCard({ agent }: { agent: AgentResult }) {
  const slots = agent.snapshot?.slots ?? [];
  const windowHours = agent.snapshot ? Math.round(agent.snapshot.window_seconds / 3600) : 5;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">
            {agent.agent}
          </span>
          {!agent.ok ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--chart-neg)]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              unreachable
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{agent.url}</span>
      </div>

      {agent.ok && slots.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Slot</th>
                <th className="px-3 py-1.5 text-right">Spawns ({windowHours}h)</th>
                <th className="px-3 py-1.5 text-right">Spawns (total)</th>
                <th className="px-3 py-1.5 text-left">Last spawn</th>
                <th className="px-3 py-1.5 text-right">Rate-limit errs</th>
                <th className="px-3 py-1.5 text-left">Last err</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {slots.map((slot) => {
                const hotErr = isRecent(slot.last_rate_limit_err_at, 3600);
                return (
                  <tr
                    key={slot.slot}
                    className={
                      hotErr
                        ? "bg-[var(--chart-neg)]/5"
                        : "hover:bg-muted/20"
                    }
                  >
                    <td className="px-3 py-1.5 font-mono">{slot.slot}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{slot.spawns_in_window}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {slot.spawns_total}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {relativeTime(slot.last_spawn_at)}
                    </td>
                    <td
                      className={
                        slot.rate_limit_errs_total > 0
                          ? "px-3 py-1.5 text-right font-mono font-semibold text-[var(--chart-neg)]"
                          : "px-3 py-1.5 text-right font-mono text-muted-foreground"
                      }
                    >
                      {slot.rate_limit_errs_total}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {!isZeroTime(slot.last_rate_limit_err_at) ? (
                        <span title={slot.last_rate_limit_err_excerpt ?? ""}>
                          {relativeTime(slot.last_rate_limit_err_at)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          {agent.error ? agent.error : "no spawns observed yet"}
        </div>
      )}
    </div>
  );
}

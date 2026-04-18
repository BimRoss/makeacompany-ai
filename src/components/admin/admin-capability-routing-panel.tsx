"use client";

import { useCallback, useEffect, useState } from "react";

export type CapabilityRoutingEvent = {
  ts?: string;
  channel_id?: string;
  message_ts?: string;
  thread_ts?: string;
  employee_id?: string;
  keyword_intent?: string;
  merged_from_resolver?: string;
  final_intent?: string;
  policy_reason?: string;
  llm_ran?: boolean;
  llm_skipped_reason?: string;
  llm_tool_intent?: string;
  llm_confidence?: number;
  llm_reason?: string;
  llm_primary_specialist?: string;
};

type Props = {
  channelId: string;
};

export function AdminCapabilityRoutingPanel({ channelId }: Props) {
  const [events, setEvents] = useState<CapabilityRoutingEvent[]>([]);
  const [redisKey, setRedisKey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/capability-routing-events?channelId=${encodeURIComponent(channelId)}&limit=40`,
        { cache: "no-store" },
      );
      const payload = (await res.json().catch(() => null)) as {
        events?: CapabilityRoutingEvent[];
        redisKey?: string;
        error?: string;
      } | null;
      if (res.status === 401) {
        setError("Unauthorized. Ensure BACKEND_INTERNAL_SERVICE_TOKEN is configured for this deployment.");
        setEvents([]);
        return;
      }
      if (!res.ok || !payload || !Array.isArray(payload.events)) {
        setError(payload?.error ?? "Failed to load routing events.");
        setEvents([]);
        return;
      }
      setEvents(payload.events);
      setRedisKey(typeof payload.redisKey === "string" ? payload.redisKey : "");
    } catch {
      setError("Failed to load routing events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!channelId) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm" aria-labelledby="cap-routing-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="cap-routing-heading" className="text-sm font-semibold tracking-tight">
          Slack capability routing (debug)
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      {redisKey ? (
        <p className="mb-2 font-mono text-[11px] text-muted-foreground">Redis: {redisKey}</p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events yet. Traffic from employee-factory pods with{" "}
          <code className="rounded bg-muted px-1">CAPABILITY_ROUTING_OBS_ENABLED</code> will appear here.
        </p>
      ) : null}
      {!loading && events.length > 0 ? (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Time</th>
                <th className="py-1.5 pr-2 font-medium">Pod</th>
                <th className="py-1.5 pr-2 font-medium">Final</th>
                <th className="py-1.5 pr-2 font-medium">Policy</th>
                <th className="py-1.5 pr-2 font-medium">KW</th>
                <th className="py-1.5 pr-2 font-medium">LLM</th>
                <th className="py-1.5 pr-2 font-medium">Conf</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={`${ev.ts ?? ""}-${ev.message_ts ?? ""}-${ev.employee_id ?? ""}-${i}`} className="border-b border-border/60 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{ev.ts ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-mono">{ev.employee_id ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-mono">{ev.final_intent ?? "—"}</td>
                  <td className="py-1.5 pr-2">{ev.policy_reason ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-mono text-[11px]">{ev.keyword_intent ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-mono text-[11px]">{ev.llm_tool_intent ?? (ev.llm_skipped_reason ? `(${ev.llm_skipped_reason})` : "—")}</td>
                  <td className="py-1.5 pr-2">{ev.llm_confidence != null ? ev.llm_confidence.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

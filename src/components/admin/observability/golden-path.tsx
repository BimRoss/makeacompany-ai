"use client";

import { useMemo } from "react";

import { useRangeQuery } from "./charts/use-range-query";
import { formatMs } from "./charts/format";

const OVERALL_OK = 'makeacompany_synthetic_ok{step="overall"}';
const PROBE_DURATION = "makeacompany_synthetic_duration_seconds";

type FlowStatus = {
  flow: string;
  label: string;
  state: "operational" | "down" | "unknown";
  history: Array<[number, number]>;
  durationSeconds: number | null;
  lastAt: number | null;
};

function humanizeFlow(flow: string): string {
  const cleaned = flow.replace(/_/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function GoldenPath() {
  // Short fixed window — this is a "right now" signal, independent of the page range.
  const { series, loading } = useRangeQuery([OVERALL_OK, PROBE_DURATION], "now-1h");

  const flows = useMemo<FlowStatus[]>(() => {
    const all = series ?? [];
    const okSeries = all.filter((s) => s.query === OVERALL_OK && s.labels.flow);
    const durSeries = all.filter((s) => s.query === PROBE_DURATION && s.labels.flow);
    const durByFlow = new Map<string, number>();
    for (const d of durSeries) {
      const last = d.points.at(-1);
      if (last) durByFlow.set(d.labels.flow, last[1]);
    }
    return okSeries
      .map((s): FlowStatus => {
        const last = s.points.at(-1);
        const state = last ? (last[1] >= 1 ? "operational" : "down") : "unknown";
        return {
          flow: s.labels.flow,
          label: humanizeFlow(s.labels.flow),
          state,
          history: s.points.slice(-40),
          durationSeconds: durByFlow.get(s.labels.flow) ?? null,
          lastAt: last ? last[0] : null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [series]);

  const allOk = flows.length > 0 && flows.every((f) => f.state === "operational");

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <h3 className="font-display text-sm font-semibold tracking-tight">Cron jobs</h3>
          {flows.length > 0 ? (
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                allOk
                  ? "border-[var(--chart-pos)]/40 text-[var(--chart-pos)]"
                  : "border-[var(--chart-neg)]/40 text-[var(--chart-neg)]"
              }`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: allOk ? "var(--chart-pos)" : "var(--chart-neg)" }}
              />
              {allOk ? "all green" : "attention"}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="flex flex-1 gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-7 flex-1 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : flows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Probe isn&apos;t reporting.</p>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
            {flows.map((f) => (
              <FlowStrip key={f.flow} flow={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowStrip({ flow }: { flow: FlowStatus }) {
  const tone =
    flow.state === "operational"
      ? "var(--chart-pos)"
      : flow.state === "down"
        ? "var(--chart-neg)"
        : "var(--chart-muted)";
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone }} />
      <span className="shrink-0 text-[11px] font-medium text-foreground">{flow.label}</span>
      <UptimeBars history={flow.history} />
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {flow.durationSeconds !== null ? formatMs(flow.durationSeconds) : "—"}
      </span>
    </div>
  );
}

function UptimeBars({ history }: { history: Array<[number, number]> }) {
  // status-page style: one slim bar per recent sample, green ok / red fail.
  const bars = history.length > 0 ? history : [];
  return (
    <div className="flex h-3 min-w-0 flex-1 items-stretch gap-[2px]">
      {bars.length === 0
        ? Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="flex-1 rounded-sm bg-muted" />
          ))
        : bars.map(([ts, v], i) => (
            <span
              key={`${ts}-${i}`}
              className="flex-1 rounded-sm"
              title={new Date(ts * 1000).toLocaleTimeString()}
              style={{ backgroundColor: v >= 1 ? "var(--chart-pos)" : "var(--chart-neg)", opacity: 0.85 }}
            />
          ))}
    </div>
  );
}

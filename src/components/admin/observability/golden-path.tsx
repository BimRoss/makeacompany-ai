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
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight">Golden path</h3>
          <p className="hidden text-xs text-muted-foreground sm:block">
            End-to-end probe — reads each snapshot back and checks freshness.
          </p>
        </div>
        {flows.length > 0 ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              allOk
                ? "border-[var(--chart-pos)]/40 text-[var(--chart-pos)]"
                : "border-[var(--chart-neg)]/40 text-[var(--chart-neg)]"
            }`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: allOk ? "var(--chart-pos)" : "var(--chart-neg)" }}
            />
            {allOk ? "All systems go" : "Attention"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : flows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Probe isn&apos;t reporting — the product-works signal is dark.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {flows.map((f) => (
            <FlowCard key={f.flow} flow={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FlowCard({ flow }: { flow: FlowStatus }) {
  const tone =
    flow.state === "operational"
      ? "var(--chart-pos)"
      : flow.state === "down"
        ? "var(--chart-neg)"
        : "var(--chart-muted)";
  const word =
    flow.state === "operational" ? "Operational" : flow.state === "down" ? "Down" : "Unknown";

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{flow.label}</div>
        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: tone }}
        >
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tone }} />
          {word}
        </span>
      </div>
      <UptimeBars history={flow.history} />
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{flow.history.length} recent checks</span>
        <span className="tabular-nums">
          {flow.durationSeconds !== null ? `probe ${formatMs(flow.durationSeconds)}` : "—"}
        </span>
      </div>
    </div>
  );
}

function UptimeBars({ history }: { history: Array<[number, number]> }) {
  // status-page style: one slim bar per recent sample, green ok / red fail.
  const bars = history.length > 0 ? history : [];
  return (
    <div className="mt-2.5 flex h-7 items-stretch gap-[3px]">
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

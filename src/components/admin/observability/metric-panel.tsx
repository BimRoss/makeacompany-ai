"use client";

import { useMemo } from "react";

import { TimeSeriesChart, type ChartSeries } from "./charts/time-series-chart";
import { useRangeQuery } from "./charts/use-range-query";
import type { PanelDef } from "./panels";

function latestOf(series: ChartSeries[]): { label: string; value: number; tone: string } | null {
  // Prefer the most prominent (non-muted) line's latest value for the headline.
  const ranked = [...series].sort((a, b) => toneRank(b.tone) - toneRank(a.tone));
  for (const s of ranked) {
    const last = s.points.at(-1);
    if (last) return { label: s.label, value: last[1], tone: s.tone };
  }
  return null;
}

function toneRank(tone: string): number {
  return { neg: 4, accent: 3, ink: 2, pos: 1, muted: 0 }[tone] ?? 0;
}

const TONE_VAR: Record<string, string> = {
  ink: "var(--chart-ink)",
  accent: "var(--chart-accent)",
  muted: "var(--chart-muted)",
  pos: "var(--chart-pos)",
  neg: "var(--chart-neg)",
};

export function MetricPanel({ def, from }: { def: PanelDef; from: string }) {
  const { series, loading, errored } = useRangeQuery(def.queries, def.forceFrom ?? from);
  const chartSeries = useMemo(() => def.toSeries(series ?? []), [def, series]);
  const headline = useMemo(() => latestOf(chartSeries), [chartSeries]);
  const multi = chartSeries.length > 1;

  return (
    <article
      className={`group flex flex-col rounded-2xl border border-border bg-card p-4 transition-colors duration-200 hover:border-foreground/25 ${
        def.span === 2 ? "sm:col-span-2" : ""
      }`}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
            {def.title}
          </h3>
          {def.subtitle ? (
            <p className="truncate text-[11px] text-muted-foreground">{def.subtitle}</p>
          ) : null}
        </div>
        {headline && !loading ? (
          <div
            className="shrink-0 font-display text-lg font-semibold tabular-nums leading-none"
            style={{ color: TONE_VAR[headline.tone] }}
          >
            {def.format(headline.value)}
          </div>
        ) : null}
      </header>

      {multi ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {chartSeries.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-1 w-3 rounded-full"
                style={{ backgroundColor: TONE_VAR[s.tone], opacity: s.tone === "muted" ? 0.7 : 1 }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto">
        {loading ? (
          <div className="h-[188px] w-full animate-pulse rounded-lg bg-muted" />
        ) : (
          <TimeSeriesChart
            series={chartSeries}
            format={def.format}
            area={def.area}
            zeroBaseline={def.zeroBaseline ?? true}
            emptyLabel={errored ? "Metric unavailable" : "No data in range"}
          />
        )}
      </div>
    </article>
  );
}

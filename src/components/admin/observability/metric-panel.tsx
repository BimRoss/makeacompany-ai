"use client";

import { useCallback, useMemo, useState } from "react";

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

/**
 * Hover-revealed chip that copies the panel's PromQL to the clipboard.
 * Hidden by default to keep the panel header uncluttered; appears via
 * the parent's `group-hover:opacity-100`. Briefly flashes "Copied" so
 * you know it worked without needing a toast system.
 */
function CopyQueriesChip({ queries }: { queries: string[] }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(queries.join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard write can fail in insecure contexts; the user can fall
      // back to inspecting the network tab or Grafana link.
    }
  }, [queries]);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy PromQL to clipboard"
      className="shrink-0 inline-flex items-center rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:border-foreground/30 hover:text-foreground focus:opacity-100"
    >
      {copied ? "Copied" : "PromQL"}
    </button>
  );
}

export function MetricPanel({
  def,
  from,
  prominent = false,
}: {
  def: PanelDef;
  from: string;
  prominent?: boolean;
}) {
  const { series, loading, errored } = useRangeQuery(def.queries, from);
  const chartSeries = useMemo(() => def.toSeries(series ?? []), [def, series]);
  const headline = useMemo(() => latestOf(chartSeries), [chartSeries]);
  const multi = chartSeries.length > 1;
  const isEmpty = chartSeries.every((s) => s.points.length === 0);

  if (def.hideWhenEmpty && !loading && !errored && isEmpty) {
    return null;
  }

  return (
    <article
      className={`group flex flex-col rounded-2xl border border-border bg-card p-4 transition-colors duration-200 hover:border-foreground/25 ${
        def.span === 2 && !prominent ? "sm:col-span-2" : ""
      }`}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className={`truncate font-display font-semibold tracking-tight text-foreground ${
              prominent ? "text-base" : "text-sm"
            }`}
          >
            {def.title}
          </h3>
          {def.subtitle ? (
            <p className="truncate text-[11px] text-muted-foreground">{def.subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <CopyQueriesChip queries={def.queries} />
          {headline && !loading ? (
            <div
              className={`font-display font-semibold tabular-nums leading-none ${
                prominent ? "text-2xl" : "text-lg"
              }`}
              style={{ color: TONE_VAR[headline.tone] }}
            >
              {def.format(headline.value)}
            </div>
          ) : null}
        </div>
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
          <div
            className={`w-full animate-pulse rounded-lg bg-muted ${prominent ? "h-[280px]" : "h-[188px]"}`}
          />
        ) : (
          <TimeSeriesChart
            series={chartSeries}
            format={def.format}
            area={def.area}
            zeroBaseline={def.zeroBaseline ?? true}
            emptyLabel={errored ? "Metric unavailable" : "No data in range"}
            height={prominent ? 280 : undefined}
          />
        )}
      </div>
    </article>
  );
}

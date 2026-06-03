"use client";

import { useMemo } from "react";

import { TimeSeriesChart, type ChartSeries, type ChartTone } from "./charts/time-series-chart";
import { formatCompact, formatPercent } from "./charts/format";
import { useGscSummary, type GscSummary } from "./kpi-scorecard";

type DailyPoint = { date: string; impressions: number; clicks: number; ctr: number; position: number };

type GscWithDaily = GscSummary & {
  daily?: DailyPoint[];
  dailyStartDate?: string;
  dailyEndDate?: string;
};

const TONE_VAR: Record<ChartTone, string> = {
  ink: "var(--chart-ink)",
  accent: "var(--chart-accent)",
  muted: "var(--chart-muted)",
  pos: "var(--chart-pos)",
  neg: "var(--chart-neg)",
};

function dateToSeconds(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

function formatPosition(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(1);
}

type PanelProps = {
  title: string;
  subtitle: string;
  series: ChartSeries[];
  format: (n: number) => string;
  loading: boolean;
  invertHeadline?: boolean;
};

function Panel({ title, subtitle, series, format, loading, invertHeadline }: PanelProps) {
  const headline = useMemo(() => {
    for (const s of series) {
      const last = s.points.at(-1);
      if (last) return { value: last[1], tone: s.tone };
    }
    return null;
  }, [series]);
  const multi = series.length > 1;

  return (
    <article className="group flex flex-col rounded-2xl border border-border bg-card p-4 transition-colors duration-200 hover:border-foreground/25">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        {headline && !loading ? (
          <div
            className="shrink-0 font-display text-lg font-semibold tabular-nums leading-none"
            style={{ color: TONE_VAR[headline.tone] }}
          >
            {format(headline.value)}
          </div>
        ) : null}
      </header>

      {multi ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-1 w-3 rounded-full"
                style={{ backgroundColor: TONE_VAR[s.tone] }}
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
            series={series}
            format={format}
            zeroBaseline={!invertHeadline}
            emptyLabel="No search data in range"
          />
        )}
      </div>
    </article>
  );
}

export function SearchTimeseriesPanels() {
  const gsc = useGscSummary() as GscWithDaily | null;
  const loading = gsc === null;
  const daily = gsc?.daily ?? [];

  const clicksImpressions: ChartSeries[] = useMemo(
    () => [
      {
        key: "gsc-impressions",
        label: "impressions",
        tone: "muted",
        points: daily.map((d) => [dateToSeconds(d.date), d.impressions] as [number, number]),
      },
      {
        key: "gsc-clicks",
        label: "clicks",
        tone: "accent",
        points: daily.map((d) => [dateToSeconds(d.date), d.clicks] as [number, number]),
      },
    ],
    [daily],
  );

  const ctrSeries: ChartSeries[] = useMemo(
    () => [
      {
        key: "gsc-ctr",
        label: "CTR",
        tone: "pos",
        points: daily.map((d) => [dateToSeconds(d.date), d.ctr] as [number, number]),
      },
    ],
    [daily],
  );

  const positionSeries: ChartSeries[] = useMemo(
    () => [
      {
        key: "gsc-position",
        label: "avg position",
        tone: "ink",
        points: daily
          .filter((d) => d.position > 0)
          .map((d) => [dateToSeconds(d.date), d.position] as [number, number]),
      },
    ],
    [daily],
  );

  if (!loading && daily.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
      <Panel
        title="Clicks + impressions"
        subtitle="Daily, last 28d"
        series={clicksImpressions}
        format={formatCompact}
        loading={loading}
      />
      <Panel
        title="CTR"
        subtitle="Clicks / impressions, daily"
        series={ctrSeries}
        format={(n) => formatPercent(n)}
        loading={loading}
      />
      <Panel
        title="Avg position"
        subtitle="Lower is better"
        series={positionSeries}
        format={formatPosition}
        loading={loading}
        invertHeadline
      />
    </div>
  );
}

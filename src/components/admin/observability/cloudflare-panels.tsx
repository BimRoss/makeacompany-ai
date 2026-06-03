"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

import { TimeSeriesChart, type ChartSeries, type ChartTone } from "./charts/time-series-chart";
import { formatPercent, formatPerMin } from "./charts/format";

type Point = [number, number];

type CloudflarePayload = {
  asOf?: string;
  windowStart?: string;
  windowEnd?: string;
  zoneTag?: string;
  panels?: {
    requestsPerMin?: Point[];
    bandwidthBps?: Point[];
    cacheHitRatio?: Point[];
    statusClass?: {
      reqs2xx?: Point[];
      reqs4xx?: Point[];
      reqs5xx?: Point[];
    };
  };
  error?: string;
};

const POLL_MS = 60_000;
const PANEL_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

const TONE_VAR: Record<ChartTone, string> = {
  ink: "var(--chart-ink)",
  accent: "var(--chart-accent)",
  muted: "var(--chart-muted)",
  pos: "var(--chart-pos)",
  neg: "var(--chart-neg)",
};

function useCloudflareSummary() {
  const [payload, setPayload] = useState<CloudflarePayload | null>(null);
  const [errored, setErrored] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/cloudflare/summary", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        if (cancelledRef.current) return;
        const body = (await response.json()) as CloudflarePayload;
        if (!response.ok) {
          setErrored(body.error ?? `http ${response.status}`);
          setPayload(body);
          return;
        }
        setPayload(body);
        setErrored(null);
      } catch (error) {
        if (cancelledRef.current) return;
        setErrored(error instanceof Error ? error.message : "fetch failed");
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, []);

  return { payload, loading: payload === null && errored === null, errored };
}

function formatBandwidth(bytesPerSec: number): string {
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1_000_000_000) return `${(bitsPerSec / 1_000_000_000).toFixed(2)} Gbps`;
  if (bitsPerSec >= 1_000_000) return `${(bitsPerSec / 1_000_000).toFixed(2)} Mbps`;
  if (bitsPerSec >= 1_000) return `${(bitsPerSec / 1_000).toFixed(1)} kbps`;
  return `${bitsPerSec.toFixed(0)} bps`;
}

type PanelShellProps = {
  title: string;
  subtitle: string;
  span?: 1 | 2;
  series: ChartSeries[];
  format: (n: number) => string;
  area?: boolean;
  zeroBaseline?: boolean;
  loading: boolean;
  emptyLabel: string;
};

function PanelShell({
  title,
  subtitle,
  span,
  series,
  format,
  area,
  zeroBaseline,
  loading,
  emptyLabel,
}: PanelShellProps) {
  const ranked = useMemo(() => [...series].sort((a, b) => toneRank(b.tone) - toneRank(a.tone)), [series]);
  const headline = ranked.find((s) => s.points.length > 0)?.points.at(-1);
  const headlineTone = ranked.find((s) => s.points.length > 0)?.tone ?? "accent";
  const multi = series.length > 1;

  return (
    <article
      className={`group flex flex-col rounded-2xl border border-border bg-card p-4 transition-colors duration-200 hover:border-foreground/25 ${
        span === 2 ? "sm:col-span-2" : ""
      }`}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        {headline && !loading ? (
          <div
            className="shrink-0 font-display text-lg font-semibold tabular-nums leading-none"
            style={{ color: TONE_VAR[headlineTone] }}
          >
            {format(headline[1])}
          </div>
        ) : null}
      </header>

      {multi ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {series.map((s) => (
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
            series={series}
            format={format}
            area={area}
            zeroBaseline={zeroBaseline ?? true}
            emptyLabel={emptyLabel}
          />
        )}
      </div>
    </article>
  );
}

function toneRank(tone: ChartTone): number {
  return { neg: 4, accent: 3, ink: 2, pos: 1, muted: 0 }[tone];
}

export function CloudflarePanels() {
  const { payload, loading, errored } = useCloudflareSummary();

  if (errored && !loading) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        Cloudflare panels unavailable: {errored}
      </div>
    );
  }

  const panels = payload?.panels;
  const requestsSeries: ChartSeries[] = [
    {
      key: "cf-requests",
      label: "requests/min",
      tone: "accent",
      points: panels?.requestsPerMin ?? [],
    },
  ];
  const bandwidthSeries: ChartSeries[] = [
    {
      key: "cf-bandwidth",
      label: "edge bandwidth",
      tone: "ink",
      points: panels?.bandwidthBps ?? [],
    },
  ];
  const cacheSeries: ChartSeries[] = [
    {
      key: "cf-cache-hit",
      label: "cache hit ratio",
      tone: "pos",
      points: panels?.cacheHitRatio ?? [],
    },
  ];
  const statusSeries: ChartSeries[] = [
    { key: "cf-2xx", label: "2xx", tone: "pos", points: panels?.statusClass?.reqs2xx ?? [] },
    { key: "cf-4xx", label: "4xx", tone: "accent", points: panels?.statusClass?.reqs4xx ?? [] },
    { key: "cf-5xx", label: "5xx", tone: "neg", points: panels?.statusClass?.reqs5xx ?? [] },
  ];

  const empty = "No edge data in range";

  return (
    <div className={PANEL_GRID}>
      <PanelShell
        title="Edge requests"
        subtitle="Cloudflare requests per minute (1h buckets)"
        span={2}
        series={requestsSeries}
        format={formatPerMin}
        area
        loading={loading}
        emptyLabel={empty}
      />
      <PanelShell
        title="Cache hit ratio"
        subtitle="Share served from Cloudflare cache"
        series={cacheSeries}
        format={(n) => formatPercent(n)}
        zeroBaseline
        loading={loading}
        emptyLabel={empty}
      />
      <PanelShell
        title="Edge bandwidth"
        subtitle="Bytes served to clients, averaged per second"
        series={bandwidthSeries}
        format={formatBandwidth}
        area
        loading={loading}
        emptyLabel={empty}
      />
      <PanelShell
        title="Responses by status"
        subtitle="2xx / 4xx / 5xx requests per minute"
        series={statusSeries}
        format={formatPerMin}
        loading={loading}
        emptyLabel={empty}
      />
      <PanelShell
        title="5xx rate"
        subtitle="Edge 5xx responses per minute"
        series={[
          {
            key: "cf-5xx-solo",
            label: "5xx/min",
            tone: "neg",
            points: panels?.statusClass?.reqs5xx ?? [],
          },
        ]}
        format={formatPerMin}
        area
        zeroBaseline
        loading={loading}
        emptyLabel={empty}
      />
    </div>
  );
}

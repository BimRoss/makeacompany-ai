"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { useCloudflareSummary } from "./cloudflare-panels";
import { useRangeQuery } from "./charts/use-range-query";

type KpiTile = {
  id: string;
  label: string;
  query: string | null;
  format: (value: number) => string;
  thresholds: Threshold[];
  /** Higher = better when true; flips threshold comparison. */
  higherIsBetter?: boolean;
  /** When null query → static derived value (e.g. alert count from AlertsProvider). */
  staticValue?: number;
};

type Threshold = { value: number; color: "green" | "amber" | "red" };

type PromResult = { query: string; value: number | null; error: string | null };

const POLL_INTERVAL_MS = 30_000;

const POOL = {
  successRatio: 'sum(rate(makeacompany_http_requests_total{status_class="2xx"}[5m])) / clamp_min(sum(rate(makeacompany_http_requests_total[5m])), 0.0001)',
  p95: "histogram_quantile(0.95, sum by (le) (rate(makeacompany_http_request_duration_seconds_bucket[5m])))",
  errorsPerMin: 'sum(rate(makeacompany_http_requests_total{status_class="5xx"}[5m])) * 60',
} as const;

function colorFor(thresholds: Threshold[], value: number, higherIsBetter: boolean): "green" | "amber" | "red" {
  if (higherIsBetter) {
    // sorted ascending; pick the highest threshold met
    let color: "green" | "amber" | "red" = "red";
    for (const t of thresholds) {
      if (value >= t.value) color = t.color;
    }
    return color;
  }
  // lower is better: pick the lowest threshold met (assumes ascending value, increasing severity)
  let color: "green" | "amber" | "red" = "green";
  for (const t of thresholds) {
    if (value >= t.value) color = t.color;
  }
  return color;
}

const dotColor: Record<"green" | "amber" | "red", string> = {
  green: "var(--chart-pos)",
  amber: "#f59e0b",
  red: "var(--chart-neg)",
};

/**
 * Inline 1h sparkline for KPI tiles. Pure SVG so it inherits the card's
 * background; no axes, no ticks — just shape + trailing dot.
 */
function Sparkline({
  points,
  color,
}: {
  points: Array<[number, number]>;
  color: string;
}) {
  if (points.length < 2) return null;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [, v] of points) {
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  const xMin = points[0][0];
  const xMax = points[points.length - 1][0];
  const xRange = xMax - xMin || 1;
  // Pad y so a flat series renders as a centered line (not stuck on edges).
  const yPad = yMax === yMin ? Math.abs(yMax) * 0.05 + 0.001 : 0;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const yRange = yHi - yLo || 1;
  const W = 100;
  const H = 20;
  const projectY = (v: number) => H - 2 - ((v - yLo) / yRange) * (H - 4);
  const path = points
    .map(([t, v], i) => {
      const x = ((t - xMin) / xRange) * W;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${projectY(v).toFixed(2)}`;
    })
    .join(" ");
  const lastY = projectY(points[points.length - 1][1]);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-5 w-full"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} opacity={0.65} />
      <circle cx={W} cy={lastY} r={1.5} fill={color} />
    </svg>
  );
}

/** Empty placeholder occupying the same vertical space as a Sparkline. */
function SparklineSpacer() {
  return <div className="mt-2 h-5" aria-hidden="true" />;
}

function ScorecardTile({
  label,
  value,
  formatted,
  thresholds,
  higherIsBetter,
  hasError,
  spark,
}: {
  label: string;
  value: number | null;
  formatted: string;
  thresholds: Threshold[];
  higherIsBetter: boolean;
  hasError: boolean;
  spark?: Array<[number, number]>;
}) {
  const color = value === null ? null : colorFor(thresholds, value, higherIsBetter);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-3 transition-colors duration-200 hover:border-foreground/25">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {color ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor[color] }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div
        className={`mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums ${
          value === null ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {value === null ? (hasError ? "—" : "…") : formatted}
      </div>
      {spark && spark.length >= 2 ? (
        <Sparkline points={spark} color={color ? dotColor[color] : "var(--chart-muted)"} />
      ) : (
        <SparklineSpacer />
      )}
    </div>
  );
}

/** Informational tile (no threshold coloring) for traffic metrics like GA4. */
function InfoTile({
  label,
  value,
  spark,
}: {
  label: string;
  value: string;
  spark?: Array<[number, number]>;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-3 transition-colors duration-200 hover:border-foreground/25">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--chart-accent)" }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      {spark && spark.length >= 2 ? (
        <Sparkline points={spark} color="var(--chart-accent)" />
      ) : (
        <SparklineSpacer />
      )}
    </div>
  );
}

export type Ga4Summary = {
  status?: "ok" | "disabled" | "degraded";
  activeUsers?: number;
  sessions?: number;
  realtimeUsers?: number;
  activeUsersDaily?: { date: string; value: number }[];
  sessionsDaily?: { date: string; value: number }[];
  topPages?: { path: string; views: number; users: number }[];
  sources?: { channel: string; sessions: number; users: number }[];
  countries?: { country: string; users: number }[];
  devices?: { device: string; sessions: number; users: number }[];
};

type GscDailyPoint = { date: string; impressions: number; clicks: number; ctr: number; position: number };

export type GscSummary = {
  status?: "ok" | "disabled" | "degraded";
  siteUrl?: string;
  startDate?: string;
  endDate?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  daily?: GscDailyPoint[];
  topQueries?: { query: string; impressions: number; clicks: number; ctr: number; position: number }[];
  topPages?: { page: string; impressions: number; clicks: number; ctr: number; position: number }[];
  deviceSplit?: { device: string; impressions: number; clicks: number; ctr: number; position: number }[];
  topHosts?: { host: string; impressions: number; clicks: number }[];
};

/** Project a named-value series into the [t, v] pairs Sparkline expects. Index as x keeps the rendering format-agnostic. */
function dailyToSpark<T>(rows: T[] | undefined, pick: (row: T) => number): Array<[number, number]> | undefined {
  if (!rows || rows.length < 2) return undefined;
  return rows.map((row, i) => [i, pick(row)]);
}

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatPercent(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function formatPosition(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(1);
}

export function useGa4Summary(): Ga4Summary | null {
  const [payload, setPayload] = useState<Ga4Summary | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/ga4-summary", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        const json = (await response.json()) as Ga4Summary;
        if (!cancelled) setPayload(json);
      } catch {
        if (!cancelled) setPayload({ status: "degraded" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return payload;
}

type MessagesTotalPayload = { total_messages?: number };

type EngagementDayBin = { day?: string; messages?: number };
type EngagementTopUser = {
  slack_user_id?: string;
  total_messages?: number;
  sparkline?: EngagementDayBin[];
};
type EngagementTopPayload = { users?: EngagementTopUser[] };

export type TotalMessages = {
  total: number | null;
  /** 30-day daily totals summed across the top-N users. Indexed x keeps Sparkline format-agnostic. */
  daily: Array<[number, number]> | undefined;
};

export function useTotalMessages(): TotalMessages {
  const [total, setTotal] = useState<number | null>(null);
  const [daily, setDaily] = useState<Array<[number, number]> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [totalRes, topRes] = await Promise.all([
          fetch("/api/admin/user-engagement/total", { cache: "no-store" }),
          fetch("/api/admin/user-engagement/top?limit=500", { cache: "no-store" }),
        ]);
        if (kickToLoginForUnauthorizedApi(totalRes.status, "admin")) return;
        if (kickToLoginForUnauthorizedApi(topRes.status, "admin")) return;
        if (totalRes.ok) {
          const json = (await totalRes.json()) as MessagesTotalPayload;
          if (!cancelled && typeof json?.total_messages === "number") {
            setTotal(json.total_messages);
          }
        }
        if (topRes.ok) {
          const json = (await topRes.json()) as EngagementTopPayload;
          // Sum per-user 30-day sparklines into one daily total series. The
          // top endpoint caps at 500 users — well above current cohort size,
          // so this is the all-time total for any realistic day in window.
          const byDay = new Map<string, number>();
          for (const u of json?.users ?? []) {
            for (const bin of u.sparkline ?? []) {
              if (!bin || typeof bin.day !== "string") continue;
              const v = typeof bin.messages === "number" ? bin.messages : 0;
              byDay.set(bin.day, (byDay.get(bin.day) ?? 0) + v);
            }
          }
          const days = Array.from(byDay.keys()).sort();
          const points: Array<[number, number]> = days.map((d, i) => [i, byDay.get(d) ?? 0]);
          if (!cancelled) setDaily(points.length >= 2 ? points : undefined);
        }
      } catch {
        // Tile just stays empty on failure; the headline number isn't critical.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return { total, daily };
}

export function useGscSummary(): GscSummary | null {
  const [payload, setPayload] = useState<GscSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/gsc-summary", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        const json = (await response.json()) as GscSummary;
        if (!cancelled) setPayload(json);
      } catch {
        if (!cancelled) setPayload({ status: "degraded" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return payload;
}

export function KpiScorecard() {
  const ga4 = useGa4Summary();
  const gsc = useGscSummary();
  const totalMessages = useTotalMessages();
  const { payload: cloudflarePayload } = useCloudflareSummary();
  const cacheHit = cloudflarePayload?.summary?.cacheHitRatio24h;
  const fwTotal = cloudflarePayload?.summary?.firewallEventsTotal;
  const [results, setResults] = useState<PromResult[] | null>(null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  const tiles = useMemo<KpiTile[]>(
    () => [
      {
        id: "success",
        label: "Success rate (5m)",
        query: POOL.successRatio,
        format: (v) => `${(v * 100).toFixed(2)}%`,
        higherIsBetter: true,
        thresholds: [
          { value: 0, color: "red" },
          { value: 0.95, color: "amber" },
          { value: 0.99, color: "green" },
        ],
      },
      {
        id: "p95",
        label: "P95 latency (5m)",
        query: POOL.p95,
        format: (v) => `${(v * 1000).toFixed(0)} ms`,
        thresholds: [
          { value: 0, color: "green" },
          { value: 0.5, color: "amber" },
          { value: 1, color: "red" },
        ],
      },
      {
        id: "errors",
        label: "Errors /min (5m)",
        query: POOL.errorsPerMin,
        format: (v) => (v < 10 ? v.toFixed(1) : v.toFixed(0)),
        thresholds: [
          { value: 0, color: "green" },
          { value: 1, color: "amber" },
          { value: 5, color: "red" },
        ],
      },
    ],
    []
  );

  useEffect(() => {
    cancelledRef.current = false;
    // POOL queries are module-level constants; the alert tile uses staticValue, no query.
    const queries = Object.values(POOL);

    const load = async () => {
      try {
        const url = new URL("/api/admin/prom-query", window.location.origin);
        for (const q of queries) url.searchParams.append("q", q);
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        if (!response.ok) {
          if (!cancelledRef.current) setErrored(true);
          return;
        }
        const payload = (await response.json()) as { results?: PromResult[] };
        if (cancelledRef.current) return;
        setResults(Array.isArray(payload.results) ? payload.results : []);
        setErrored(false);
      } catch {
        if (!cancelledRef.current) setErrored(true);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, []);

  const resultByQuery = useMemo(() => {
    const map = new Map<string, PromResult>();
    for (const r of results ?? []) map.set(r.query, r);
    return map;
  }, [results]);

  // Range-history fetch in parallel with instant values, for the inline
  // sparklines on health tiles. Tight 1h window keeps the cardinality low
  // and the trend recent enough to matter for incident triage.
  const sparkQueries = useMemo(() => Object.values(POOL), []);
  const { series: sparkSeries } = useRangeQuery(sparkQueries, "now-1h");
  const sparkByQuery = useMemo(() => {
    const map = new Map<string, Array<[number, number]>>();
    for (const s of sparkSeries ?? []) {
      // POOL queries are aggregations with no labels, so first series wins.
      if (!map.has(s.query)) map.set(s.query, s.points);
    }
    return map;
  }, [sparkSeries]);

  const showGa4 = ga4 !== null && ga4.status !== "disabled";
  const showGsc = gsc !== null && gsc.status !== "disabled";

  return (
    <section
      aria-label="KPI scorecard"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 min-[1800px]:grid-cols-9"
    >
      {/* Health tiles first — threshold-colored signals you scan during an incident. */}
      {tiles.map((tile) => {
        const value =
          tile.query === null
            ? tile.staticValue ?? null
            : resultByQuery.get(tile.query)?.value ?? null;
        // The errors tile only earns its real estate when something is on fire.
        if (tile.id === "errors" && (value === null || value <= 0)) return null;
        const formatted = value === null ? "" : tile.format(value);
        const spark = tile.query ? sparkByQuery.get(tile.query) : undefined;
        return (
          <ScorecardTile
            key={tile.id}
            label={tile.label}
            value={value}
            formatted={formatted}
            thresholds={tile.thresholds}
            higherIsBetter={tile.higherIsBetter ?? false}
            hasError={errored}
            spark={spark}
          />
        );
      })}
      {/* Growth tiles follow — informational, no threshold semantics. */}
      {totalMessages.total !== null ? (
        <InfoTile
          label="Messages sent · all-time"
          value={formatCount(totalMessages.total)}
          spark={totalMessages.daily}
        />
      ) : null}
      {showGa4 ? (
        <>
          {typeof ga4?.realtimeUsers === "number" && ga4.realtimeUsers >= 0 ? (
            <InfoTile label="Active now · 30m" value={formatCount(ga4.realtimeUsers)} />
          ) : null}
          <InfoTile
            label="Active users · 7d"
            value={formatCount(ga4?.activeUsers)}
            spark={dailyToSpark(ga4?.activeUsersDaily, (r) => r.value)}
          />
          <InfoTile
            label="Sessions · 7d"
            value={formatCount(ga4?.sessions)}
            spark={dailyToSpark(ga4?.sessionsDaily, (r) => r.value)}
          />
        </>
      ) : null}
      {typeof cacheHit === "number" ? (
        <InfoTile label="Cache hit · 24h" value={formatPercent(cacheHit)} />
      ) : null}
      {typeof fwTotal === "number" ? (
        <InfoTile label="Firewall events · 24h" value={formatCount(fwTotal)} />
      ) : null}
      {showGsc ? (
        <>
          <InfoTile
            label="Impressions · 7d"
            value={formatCount(gsc?.impressions)}
            spark={dailyToSpark(gsc?.daily?.slice(-7), (r) => r.impressions)}
          />
          <InfoTile
            label="Clicks · 7d"
            value={formatCount(gsc?.clicks)}
            spark={dailyToSpark(gsc?.daily?.slice(-7), (r) => r.clicks)}
          />
          <InfoTile
            label="Avg position · 7d"
            value={formatPosition(gsc?.position)}
            spark={dailyToSpark(gsc?.daily?.slice(-7), (r) => r.position)}
          />
        </>
      ) : null}
    </section>
  );
}

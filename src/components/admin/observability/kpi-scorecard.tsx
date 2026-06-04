"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { useCloudflareSummary } from "./cloudflare-panels";

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
  cronStaleness: 'max(time() - kube_cronjob_status_last_schedule_time{namespace="makeacompany-ai"})',
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

function ScorecardTile({
  label,
  value,
  formatted,
  thresholds,
  higherIsBetter,
  hasError,
}: {
  label: string;
  value: number | null;
  formatted: string;
  thresholds: Threshold[];
  higherIsBetter: boolean;
  hasError: boolean;
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
    </div>
  );
}

/** Informational tile (no threshold coloring) for traffic metrics like GA4. */
function InfoTile({ label, value }: { label: string; value: string }) {
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
    </div>
  );
}

type Ga4Summary = {
  status?: "ok" | "disabled" | "degraded";
  activeUsers?: number;
  sessions?: number;
};

export type GscSummary = {
  status?: "ok" | "disabled" | "degraded";
  siteUrl?: string;
  startDate?: string;
  endDate?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  topQueries?: { query: string; impressions: number; clicks: number; ctr: number; position: number }[];
};

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

function useGa4Summary(): Ga4Summary | null {
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
        id: "cron",
        label: "Oldest cron schedule",
        query: POOL.cronStaleness,
        format: (v) => {
          if (v < 60) return `${v.toFixed(0)}s`;
          if (v < 3600) return `${(v / 60).toFixed(0)}m`;
          return `${(v / 3600).toFixed(1)}h`;
        },
        thresholds: [
          { value: 0, color: "green" },
          { value: 3600, color: "amber" },
          { value: 5400, color: "red" },
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

  const showGa4 = ga4 !== null && ga4.status !== "disabled";
  const showGsc = gsc !== null && gsc.status !== "disabled";

  return (
    <section
      aria-label="KPI scorecard"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 min-[1800px]:grid-cols-9"
    >
      {showGa4 ? (
        <>
          <InfoTile label="Active users · 7d" value={formatCount(ga4?.activeUsers)} />
          <InfoTile label="Sessions · 7d" value={formatCount(ga4?.sessions)} />
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
          <InfoTile label="Impressions · 7d" value={formatCount(gsc?.impressions)} />
          <InfoTile label="Clicks · 7d" value={formatCount(gsc?.clicks)} />
          <InfoTile label="CTR · 7d" value={formatPercent(gsc?.ctr)} />
          <InfoTile label="Avg position · 7d" value={formatPosition(gsc?.position)} />
        </>
      ) : null}
      {tiles.map((tile) => {
        const value =
          tile.query === null
            ? tile.staticValue ?? null
            : resultByQuery.get(tile.query)?.value ?? null;
        const formatted = value === null ? "" : tile.format(value);
        return (
          <ScorecardTile
            key={tile.id}
            label={tile.label}
            value={value}
            formatted={formatted}
            thresholds={tile.thresholds}
            higherIsBetter={tile.higherIsBetter ?? false}
            hasError={errored}
          />
        );
      })}
    </section>
  );
}

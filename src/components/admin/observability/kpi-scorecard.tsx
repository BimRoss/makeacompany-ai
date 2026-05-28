"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

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

const tileBgClass: Record<"green" | "amber" | "red", string> = {
  green: "border-emerald-500/35 bg-gradient-to-br from-emerald-500/8 to-emerald-500/3 shadow-[0_8px_16px_rgba(16,185,129,0.1)]",
  amber: "border-amber-500/40 bg-gradient-to-br from-amber-500/12 to-amber-500/4 shadow-[0_8px_16px_rgba(217,119,6,0.1)]",
  red: "border-red-500/40 bg-gradient-to-br from-red-500/12 to-red-500/4 shadow-[0_8px_16px_rgba(239,68,68,0.1)]",
};

const tileTextClass: Record<"green" | "amber" | "red", string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
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
  const color = value === null ? "amber" : colorFor(thresholds, value, higherIsBetter);
  return (
    <div
      className={`group/tile relative overflow-hidden rounded-xl border p-3 transition-all duration-200 hover:shadow-md ${
        value === null ? "border-border bg-card shadow-sm" : `${tileBgClass[color]} hover:border-opacity-60`
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-transparent to-white/0 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-40 pointer-events-none" />
      <div className="relative z-10 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-2 font-display text-3xl font-bold tracking-tight tabular-nums transition-transform duration-200 group-hover/tile:scale-105 origin-left ${
          value === null ? "text-muted-foreground" : tileTextClass[color]
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
    <div className="group/tile relative overflow-hidden rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/6 to-cyan-500/2 p-3 shadow-[0_8px_16px_rgba(34,211,238,0.08)] transition-all duration-200 hover:border-cyan-500/35 hover:shadow-[0_12px_24px_rgba(34,211,238,0.12)]">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/0 via-transparent to-cyan-500/0 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-30 pointer-events-none" />
      <div className="relative z-10 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold tracking-tight tabular-nums text-cyan-700 dark:text-cyan-300 transition-transform duration-200 group-hover/tile:scale-105 origin-left">
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

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
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

export function KpiScorecard() {
  const ga4 = useGa4Summary();
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
        label: "5xx /min (5m)",
        query: POOL.errorsPerMin,
        format: (v) => v.toFixed(1),
        thresholds: [
          { value: 0, color: "green" },
          { value: 1, color: "amber" },
          { value: 5, color: "red" },
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

  return (
    <section
      aria-label="KPI scorecard"
      className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${
        showGa4 ? "min-[1800px]:grid-cols-7" : "min-[1800px]:grid-cols-5"
      }`}
    >
      {showGa4 ? (
        <>
          <InfoTile label="Active users · 7d" value={formatCount(ga4?.activeUsers)} />
          <InfoTile label="Sessions · 7d" value={formatCount(ga4?.sessions)} />
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

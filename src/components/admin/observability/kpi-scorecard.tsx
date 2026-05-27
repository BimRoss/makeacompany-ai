"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { useAlerts } from "./alerts-provider";
import { useSyntheticProbe } from "./synthetic-probe";

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
  /** Human-readable SLO target shown on hover and below the value. */
  sloTarget?: string;
  /** Alert rule names that back this tile. Used by the alert-coverage indicator. */
  alertNames?: string[];
};

type Threshold = { value: number; color: "green" | "amber" | "red" };

type PromResult = { query: string; value: number | null; error: string | null };

const POLL_INTERVAL_MS = 30_000;

const POOL = {
  successRatio:
    'sum(rate(makeacompany_http_requests_total{status_class="2xx"}[5m])) / clamp_min(sum(rate(makeacompany_http_requests_total[5m])), 0.0001)',
  p95: "histogram_quantile(0.95, sum by (le) (rate(makeacompany_http_request_duration_seconds_bucket[5m])))",
  errorsPerMin: 'sum(rate(makeacompany_http_requests_total{status_class="5xx"}[5m])) * 60',
  cronStaleness: 'max(time() - kube_cronjob_status_last_schedule_time{namespace="makeacompany-ai"})',
} as const;

function colorFor(thresholds: Threshold[], value: number, higherIsBetter: boolean): "green" | "amber" | "red" {
  if (higherIsBetter) {
    let color: "green" | "amber" | "red" = "red";
    for (const t of thresholds) {
      if (value >= t.value) color = t.color;
    }
    return color;
  }
  let color: "green" | "amber" | "red" = "green";
  for (const t of thresholds) {
    if (value >= t.value) color = t.color;
  }
  return color;
}

const tileBgClass: Record<"green" | "amber" | "red", string> = {
  green: "border-emerald-500/30 bg-emerald-500/5",
  amber: "border-amber-500/40 bg-amber-500/10",
  red: "border-red-500/40 bg-red-500/10",
};

const tileTextClass: Record<"green" | "amber" | "red", string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
};

export type KpiSelfCheckEntry = {
  id: string;
  label: string;
  color: "green" | "amber" | "red";
  hasAlertCoverage: boolean;
  alertNames: string[];
};

function ScorecardTile({
  label,
  value,
  formatted,
  thresholds,
  higherIsBetter,
  hasError,
  sloTarget,
  alertCoverage,
}: {
  label: string;
  value: number | null;
  formatted: string;
  thresholds: Threshold[];
  higherIsBetter: boolean;
  hasError: boolean;
  sloTarget?: string;
  alertCoverage: "covered" | "missing" | "n/a";
}) {
  const color = value === null ? "amber" : colorFor(thresholds, value, higherIsBetter);
  const showCoverageWarning = alertCoverage === "missing" && (color === "amber" || color === "red");
  const showCoverageOk = alertCoverage === "covered" && (color === "amber" || color === "red");
  const title = [
    sloTarget ? `SLO target: ${sloTarget}` : null,
    showCoverageWarning ? "No alert rule backs this tile — fix #78" : null,
    showCoverageOk ? "Alert rule active for this metric" : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      title={title || undefined}
      className={`relative overflow-hidden rounded-xl border p-4 shadow-sm transition @container ${
        value === null ? "border-border bg-card" : tileBgClass[color]
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {showCoverageWarning ? (
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="No alert rule backs this metric"
          />
        ) : showCoverageOk ? (
          <ShieldCheck
            className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-label="Alert rule active for this metric"
          />
        ) : null}
      </div>
      <div
        className={`mt-2 font-display text-3xl font-semibold tracking-tight @[10rem]:text-3xl ${
          value === null ? "text-muted-foreground" : tileTextClass[color]
        }`}
      >
        {value === null ? (hasError ? "—" : "…") : formatted}
      </div>
      {sloTarget ? (
        <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          target {sloTarget}
        </div>
      ) : null}
    </div>
  );
}

export function KpiScorecard({
  onSelfCheck,
}: {
  onSelfCheck?: (entries: KpiSelfCheckEntry[]) => void;
}) {
  const { firing } = useAlerts();
  const synthetic = useSyntheticProbe();
  const [results, setResults] = useState<PromResult[] | null>(null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  const firingNames = useMemo(() => new Set(firing.map((a) => a.name)), [firing]);

  const tiles = useMemo<KpiTile[]>(
    () => [
      {
        id: "success",
        label: "Success rate (5m)",
        query: POOL.successRatio,
        format: (v) => `${(v * 100).toFixed(2)}%`,
        higherIsBetter: true,
        sloTarget: "≥ 99%",
        alertNames: ["MakeacompanyLowSuccessRate", "MakeacompanyHighErrorRate"],
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
        sloTarget: "< 500ms",
        alertNames: ["MakeacompanyHighLatency"],
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
        sloTarget: "< 1/min",
        alertNames: ["MakeacompanyHighErrorRate"],
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
        sloTarget: "< 1h",
        alertNames: ["MakeacompanyCronStale"],
        thresholds: [
          { value: 0, color: "green" },
          { value: 3600, color: "amber" },
          { value: 5400, color: "red" },
        ],
      },
      {
        id: "synthetic",
        label: "Synthetic golden path",
        query: null,
        format: (v) => (v === 1 ? "OK" : "FAIL"),
        higherIsBetter: true,
        sloTarget: "always OK",
        alertNames: ["MakeacompanySyntheticDown"],
        thresholds: [
          { value: 0, color: "red" },
          { value: 1, color: "green" },
        ],
        staticValue: synthetic.ok === null ? undefined : synthetic.ok ? 1 : 0,
      },
      {
        id: "alerts",
        label: "Active alerts",
        query: null,
        format: (v) => v.toFixed(0),
        thresholds: [
          { value: 0, color: "green" },
          { value: 1, color: "amber" },
          { value: 3, color: "red" },
        ],
        staticValue: firing.length,
      },
    ],
    [firing.length, synthetic.ok]
  );

  useEffect(() => {
    cancelledRef.current = false;
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

  const resolved = useMemo(
    () =>
      tiles.map((tile) => {
        const value =
          tile.query === null
            ? tile.staticValue ?? null
            : resultByQuery.get(tile.query)?.value ?? null;
        const color: "green" | "amber" | "red" =
          value === null
            ? "amber"
            : colorFor(tile.thresholds, value, tile.higherIsBetter ?? false);
        const hasAlertCoverage = (tile.alertNames ?? []).some((name) => firingNames.has(name));
        return { tile, value, color, hasAlertCoverage };
      }),
    [tiles, resultByQuery, firingNames]
  );

  useEffect(() => {
    if (!onSelfCheck) return;
    onSelfCheck(
      resolved
        .filter(({ tile }) => (tile.alertNames?.length ?? 0) > 0)
        .map(({ tile, color, hasAlertCoverage }) => ({
          id: tile.id,
          label: tile.label,
          color,
          hasAlertCoverage,
          alertNames: tile.alertNames ?? [],
        }))
    );
  }, [onSelfCheck, resolved]);

  return (
    <section
      aria-label="KPI scorecard"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 2xl:grid-cols-6"
    >
      {resolved.map(({ tile, value, hasAlertCoverage }) => {
        const formatted = value === null ? "" : tile.format(value);
        const alertCoverage: "covered" | "missing" | "n/a" =
          (tile.alertNames?.length ?? 0) === 0
            ? "n/a"
            : hasAlertCoverage
              ? "covered"
              : "missing";
        return (
          <ScorecardTile
            key={tile.id}
            label={tile.label}
            value={value}
            formatted={formatted}
            thresholds={tile.thresholds}
            higherIsBetter={tile.higherIsBetter ?? false}
            hasError={errored}
            sloTarget={tile.sloTarget}
            alertCoverage={alertCoverage}
          />
        );
      })}
    </section>
  );
}

import type { ChartSeries, ChartTone } from "./charts/time-series-chart";
import type { RangeSeries } from "./charts/use-range-query";
import {
  formatBytes,
  formatCompact,
  formatCores,
  formatDurationDays,
  formatMs,
  formatPercent,
  formatPerMin,
} from "./charts/format";

export type PanelDef = {
  id: string;
  title: string;
  subtitle?: string;
  queries: string[];
  /** Maps raw Prometheus range series into chart lines. */
  toSeries: (raw: RangeSeries[]) => ChartSeries[];
  format: (n: number) => string;
  area?: boolean;
  zeroBaseline?: boolean;
  /** Visual span on the iPad grid: 1 (third) or 2 (two-thirds). */
  span?: 1 | 2;
  /** Hide the panel entirely when the query returns no points. */
  hideWhenEmpty?: boolean;
  /**
   * Force the headline number to use the series with this `key`, bypassing the
   * default tone-based ranking (which would otherwise pick the most "alarming"
   * line). Useful when you want the success line to drive the number even
   * while error lines are also drawn.
   */
  headlineKey?: string;
};

function pointsFor(raw: RangeSeries[], query: string): Array<[number, number]> {
  return raw.find((s) => s.query === query)?.points ?? [];
}

/** One line from one query that returns a single (aggregated) series. */
function single(query: string, label: string, tone: ChartTone) {
  return (raw: RangeSeries[]): ChartSeries[] => [
    { key: query, label, tone, points: pointsFor(raw, query) },
  ];
}

/** One line per query — used when each percentile/threshold is its own query. */
function perQuery(defs: Array<{ query: string; label: string; tone: ChartTone }>) {
  return (raw: RangeSeries[]): ChartSeries[] =>
    defs.map((d) => ({ key: d.query, label: d.label, tone: d.tone, points: pointsFor(raw, d.query) }));
}

/** Split a single query's results by a metric label (e.g. status_class, result). */
function splitByLabel(
  query: string,
  labelKey: string,
  tone: (value: string) => ChartTone,
  label: (value: string) => string = (v) => v
) {
  return (raw: RangeSeries[]): ChartSeries[] =>
    raw
      .filter((s) => s.query === query && s.labels[labelKey])
      .sort((a, b) => a.labels[labelKey].localeCompare(b.labels[labelKey]))
      .map((s) => ({
        key: `${query}-${s.labels[labelKey]}`,
        label: label(s.labels[labelKey]),
        tone: tone(s.labels[labelKey]),
        points: s.points,
      }));
}

const REQ = "makeacompany_http_requests_total";
const DUR = "makeacompany_http_request_duration_seconds_bucket";
const LIFECYCLE = "makeacompany_lifecycle_users";
const TTFV_PR_QUANTILE = "makeacompany_ttfv_pr_quantile_seconds";

const statusTone = (cls: string): ChartTone =>
  cls.startsWith("2") ? "pos" : cls.startsWith("5") ? "neg" : cls.startsWith("4") ? "accent" : "muted";

export const WEB_PANELS: PanelDef[] = [
  {
    id: "request-traffic",
    title: "Request traffic",
    subtitle: "Per minute, split by status class",
    queries: [`sum by (status_class) (rate(${REQ}[5m])) * 60`],
    toSeries: (raw) => {
      const splitQ = `sum by (status_class) (rate(${REQ}[5m])) * 60`;
      return splitByLabel(splitQ, "status_class", statusTone)(raw).map((s) =>
        s.label === "2xx" ? { ...s, key: "2xx" } : s,
      );
    },
    headlineKey: "2xx",
    format: formatPerMin,
    area: true,
    span: 2,
  },
  {
    id: "latency-percentiles",
    title: "Request latency",
    subtitle: "p50 / p95 / p99",
    queries: [
      `histogram_quantile(0.50, sum by (le) (rate(${DUR}[5m])))`,
      `histogram_quantile(0.95, sum by (le) (rate(${DUR}[5m])))`,
      `histogram_quantile(0.99, sum by (le) (rate(${DUR}[5m])))`,
    ],
    toSeries: perQuery([
      { query: `histogram_quantile(0.50, sum by (le) (rate(${DUR}[5m])))`, label: "p50", tone: "muted" },
      { query: `histogram_quantile(0.95, sum by (le) (rate(${DUR}[5m])))`, label: "p95", tone: "accent" },
      { query: `histogram_quantile(0.99, sum by (le) (rate(${DUR}[5m])))`, label: "p99", tone: "ink" },
    ]),
    format: formatMs,
  },
  {
    id: "error-rate",
    title: "Error rate",
    subtitle: "5xx share of all requests",
    queries: [
      `sum(rate(${REQ}{status_class="5xx"}[5m])) / clamp_min(sum(rate(${REQ}[5m])), 0.0001)`,
    ],
    toSeries: single(
      `sum(rate(${REQ}{status_class="5xx"}[5m])) / clamp_min(sum(rate(${REQ}[5m])), 0.0001)`,
      "5xx ratio",
      "neg"
    ),
    format: formatPercent,
    area: true,
    zeroBaseline: true,
    hideWhenEmpty: true,
  },
  {
    id: "goroutines",
    title: "Backend goroutines",
    subtitle: "Runtime concurrency",
    queries: [`go_goroutines{job="makeacompany-backend"}`],
    toSeries: single(`go_goroutines{job="makeacompany-backend"}`, "goroutines", "ink"),
    format: formatCompact,
  },
  {
    id: "backend-memory",
    title: "Backend memory",
    subtitle: "Resident set size (RSS)",
    queries: [`process_resident_memory_bytes{job="makeacompany-backend"}`],
    toSeries: single(
      `process_resident_memory_bytes{job="makeacompany-backend"}`,
      "RSS",
      "accent",
    ),
    format: formatBytes,
    area: true,
  },
];

const lifecycleTone = (status: string): ChartTone => {
  switch (status) {
    case "trialing":
      return "accent";
    case "active":
      return "pos";
    case "expired":
      return "neg";
    case "free_lifetime":
      return "ink";
    default:
      return "muted";
  }
};

const lifecycleLabel = (status: string): string =>
  status === "free_lifetime" ? "free for life" : status;

export const LIFECYCLE_PANELS: PanelDef[] = [
  {
    id: "lifecycle-users",
    title: "Lifecycle cohorts",
    subtitle: "User count by effective status, sampled every 5m",
    queries: [`${LIFECYCLE}`],
    toSeries: splitByLabel(`${LIFECYCLE}`, "status", lifecycleTone, lifecycleLabel),
    format: formatCompact,
    area: true,
    zeroBaseline: true,
    span: 2,
  },
];

const ttfvQuantileTone = (q: string): ChartTone => (q === "0.5" ? "muted" : "ink");
const ttfvQuantileLabel = (q: string): string =>
  q === "0.5" ? "p50" : q === "0.9" ? "p90" : `p${Math.round(parseFloat(q) * 100)}`;

export type TtfvCohort = "last7d" | "last30d" | "last90d";

export const TTFV_COHORTS: ReadonlyArray<{ value: TtfvCohort; label: string }> = [
  { value: "last7d", label: "L7" },
  { value: "last30d", label: "L30" },
  { value: "last90d", label: "L90" },
];

const cohortWindow = (cohort: TtfvCohort): string =>
  cohort === "last7d" ? "last 7 days" : cohort === "last30d" ? "last 30 days" : "last 90 days";

// cohortFrom maps a TTFV cohort to the chart x-axis window, so the cohort chip
// is the single control for the TTFV panels — it drives both the metric's
// aggregation window and how far back the line is drawn. Keeps TTFV off the
// shared infra range toggle, which used to double-drive it.
export const cohortFrom = (cohort: TtfvCohort): string =>
  cohort === "last7d" ? "now-7d" : cohort === "last30d" ? "now-30d" : "now-90d";

// ttfvLatencyPanel is the single TTFV view: how long it takes the users who
// convert to ship their first app (signup -> first merged PR, #621). The
// count view (how *many* convert) lives in the ActivationFunnel; the four
// older panels (message + PR, each as quantile + bucket histogram) collapsed
// into this one line plus that funnel. Message-based TTFV was retired here
// because messages are tracked elsewhere and easy to come by — first app
// shipped is the value milestone now.
export function ttfvLatencyPanel(cohort: TtfvCohort): PanelDef {
  const win = cohortWindow(cohort);
  return {
    id: `ttfv-pr-quantile-${cohort}`,
    title: "TTFV p50 / p90",
    subtitle: `Signup to first app shipped (first merged PR on the user's site repo), ${win}.`,
    queries: [`${TTFV_PR_QUANTILE}{cohort="${cohort}"}`],
    toSeries: splitByLabel(
      `${TTFV_PR_QUANTILE}{cohort="${cohort}"}`,
      "quantile",
      ttfvQuantileTone,
      ttfvQuantileLabel,
    ),
    format: formatDurationDays,
    hideWhenEmpty: true,
  };
}

const TOP_N_NAMESPACE_TONES: ChartTone[] = ["ink", "pos", "neg", "muted", "muted"];

const POD_TOTAL_QUERY = `sum(kube_pod_status_phase{phase="Running"} == 1)`;
const POD_BY_NAMESPACE_QUERY = `count by (namespace) (kube_pod_status_phase{phase="Running"} == 1)`;

function podsRunningSeries(raw: RangeSeries[]): ChartSeries[] {
  const total = raw.find((s) => s.query === POD_TOTAL_QUERY);
  const perNs = raw.filter((s) => s.query === POD_BY_NAMESPACE_QUERY && s.labels.namespace);

  const ranked = [...perNs]
    .map((s) => {
      const last = s.points.at(-1)?.[1] ?? 0;
      const peak = s.points.reduce((m, [, v]) => (v > m ? v : m), 0);
      return { s, score: last || peak };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top: ChartSeries[] = ranked.map(({ s }, i) => ({
    key: `ns-${s.labels.namespace}`,
    label: s.labels.namespace,
    tone: TOP_N_NAMESPACE_TONES[i] ?? "muted",
    points: s.points,
  }));

  const totalSeries: ChartSeries | null = total
    ? { key: "pods-total", label: "total", tone: "accent", points: total.points }
    : null;

  return totalSeries ? [totalSeries, ...top] : top;
}

const CPU_TOP_PODS_QUERY = `topk(5, sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="makeacompany-ai",container!="",container!="POD"}[5m])))`;
const MEM_TOP_PODS_QUERY = `topk(5, sum by (pod) (container_memory_working_set_bytes{namespace="makeacompany-ai",container!="",container!="POD"}))`;

function topPodsSeries(query: string) {
  return (raw: RangeSeries[]): ChartSeries[] => {
    return raw
      .filter((s) => s.query === query && s.labels.pod)
      .map((s) => {
        const last = s.points.at(-1)?.[1] ?? 0;
        const peak = s.points.reduce((m, [, v]) => (v > m ? v : m), 0);
        return { s, score: last || peak };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ s }, i) => ({
        key: `pod-${s.labels.pod}`,
        label: s.labels.pod,
        tone: TOP_N_NAMESPACE_TONES[i] ?? "muted",
        points: s.points,
      }));
  };
}

export const CLUSTER_PANELS: PanelDef[] = [
  {
    id: "pods-running",
    title: "Pods running",
    subtitle: "Cluster total, top 5 namespaces",
    queries: [POD_TOTAL_QUERY, POD_BY_NAMESPACE_QUERY],
    toSeries: podsRunningSeries,
    format: formatCompact,
    span: 2,
  },
  {
    id: "cpu-top-pods",
    title: "CPU by pod",
    subtitle: "Top 5 in makeacompany-ai (cores)",
    queries: [CPU_TOP_PODS_QUERY],
    toSeries: topPodsSeries(CPU_TOP_PODS_QUERY),
    format: formatCores,
    hideWhenEmpty: true,
  },
  {
    id: "memory-top-pods",
    title: "Memory by pod",
    subtitle: "Top 5 in makeacompany-ai (working set)",
    queries: [MEM_TOP_PODS_QUERY],
    toSeries: topPodsSeries(MEM_TOP_PODS_QUERY),
    format: formatBytes,
    hideWhenEmpty: true,
  },
];

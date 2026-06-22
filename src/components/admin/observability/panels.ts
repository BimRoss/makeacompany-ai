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
const TTFV_BUCKET = "makeacompany_ttfv_bucket_users";
const TTFV_QUANTILE = "makeacompany_ttfv_quantile_seconds";

const statusTone = (cls: string): ChartTone =>
  cls.startsWith("2") ? "pos" : cls.startsWith("5") ? "neg" : cls.startsWith("4") ? "accent" : "muted";

export const WEB_PANELS: PanelDef[] = [
  {
    id: "request-traffic",
    title: "Request traffic",
    subtitle: "Total /min, split by status class",
    queries: [
      `sum(rate(${REQ}[5m])) * 60`,
      `sum by (status_class) (rate(${REQ}[5m])) * 60`,
    ],
    toSeries: (raw) => {
      const totalQ = `sum(rate(${REQ}[5m])) * 60`;
      const splitQ = `sum by (status_class) (rate(${REQ}[5m])) * 60`;
      const total: ChartSeries = {
        key: "total",
        label: "total",
        tone: "ink",
        points: pointsFor(raw, totalQ),
      };
      const split = splitByLabel(splitQ, "status_class", statusTone)(raw);
      return [total, ...split];
    },
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

// TTFV bucket ordering follows the sweeper's seconds-upper-bound order so the
// stacked chart reads same-day at the bottom and "longer" at the top.
const TTFV_BUCKET_ORDER = ["same_day", "week", "two_weeks", "month", "quarter", "longer"];
const TTFV_BUCKET_LABELS: Record<string, string> = {
  same_day: "same day",
  week: "1–7 days",
  two_weeks: "8–14 days",
  month: "15–30 days",
  quarter: "31–90 days",
  longer: "90+ days",
};

const ttfvBucketLabel = (bucket: string): string => TTFV_BUCKET_LABELS[bucket] ?? bucket;

const ttfvBucketTone = (bucket: string): ChartTone => {
  switch (bucket) {
    case "same_day":
      return "pos";
    case "week":
      return "ink";
    case "two_weeks":
      return "accent";
    case "month":
    case "quarter":
      return "muted";
    case "longer":
    default:
      return "neg";
  }
};

const ttfvBucketSort = (a: string, b: string): number => {
  const ai = TTFV_BUCKET_ORDER.indexOf(a);
  const bi = TTFV_BUCKET_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
};

// splitByLabel sorts alphabetically by default, which puts "longer" next to
// "month" and "same_day" between "quarter" and "two_weeks" -- meaningless to
// a reader. We want the buckets in TTFV order.
function splitByLabelOrdered(
  query: string,
  labelKey: string,
  tone: (v: string) => ChartTone,
  label: (v: string) => string,
  sort: (a: string, b: string) => number,
) {
  return (raw: RangeSeries[]): ChartSeries[] =>
    raw
      .filter((s) => s.query === query && s.labels[labelKey])
      .sort((a, b) => sort(a.labels[labelKey], b.labels[labelKey]))
      .map((s) => ({
        key: `${query}-${s.labels[labelKey]}`,
        label: label(s.labels[labelKey]),
        tone: tone(s.labels[labelKey]),
        points: s.points,
      }));
}

const ttfvQuantileTone = (q: string): ChartTone => (q === "0.5" ? "muted" : "ink");
const ttfvQuantileLabel = (q: string): string =>
  q === "0.5" ? "p50" : q === "0.9" ? "p90" : `p${Math.round(parseFloat(q) * 100)}`;

export const TTFV_PANELS: PanelDef[] = [
  {
    id: "ttfv-quantile",
    title: "TTFV p50 / p90",
    subtitle:
      "Signup to first message, last 30 days. \"<1h\" means same-day — precision improves as new signups roll in.",
    queries: [`${TTFV_QUANTILE}{cohort="last30d"}`],
    toSeries: splitByLabel(
      `${TTFV_QUANTILE}{cohort="last30d"}`,
      "quantile",
      ttfvQuantileTone,
      ttfvQuantileLabel,
    ),
    format: formatDurationDays,
    hideWhenEmpty: true,
  },
  {
    id: "ttfv-distribution",
    title: "TTFV distribution",
    subtitle: "Users per bucket, last 30 days of signups. Same-day at top means onboarding is sticking.",
    queries: [`${TTFV_BUCKET}{cohort="last30d"}`],
    toSeries: splitByLabelOrdered(
      `${TTFV_BUCKET}{cohort="last30d"}`,
      "bucket",
      ttfvBucketTone,
      ttfvBucketLabel,
      ttfvBucketSort,
    ),
    format: formatCompact,
    area: true,
    zeroBaseline: true,
    span: 2,
    hideWhenEmpty: true,
  },
];

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

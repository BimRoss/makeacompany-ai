import type { ChartSeries, ChartTone } from "./charts/time-series-chart";
import type { RangeSeries } from "./charts/use-range-query";
import {
  formatCompact,
  formatDuration,
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
  /** Override the page time range for this panel (e.g. cron cadence wants 24h). */
  forceFrom?: string;
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
const REFRESH = "makeacompany_slack_refresh_runs_total";
const UPSTREAM = "makeacompany_slack_refresh_upstream_http_status_total";

const statusTone = (cls: string): ChartTone =>
  cls.startsWith("2") ? "pos" : cls.startsWith("5") ? "neg" : cls.startsWith("4") ? "accent" : "muted";

const resultTone = (r: string): ChartTone => (r === "success" ? "pos" : "neg");

export const WEB_PANELS: PanelDef[] = [
  {
    id: "request-rate",
    title: "Request throughput",
    subtitle: "Backend requests per minute",
    queries: [`sum(rate(${REQ}[5m])) * 60`],
    toSeries: single(`sum(rate(${REQ}[5m])) * 60`, "requests/min", "accent"),
    format: formatPerMin,
    area: true,
  },
  {
    id: "status-class",
    title: "Requests by status",
    subtitle: "Split by response class /min",
    queries: [`sum by (status_class) (rate(${REQ}[5m])) * 60`],
    toSeries: splitByLabel(`sum by (status_class) (rate(${REQ}[5m])) * 60`, "status_class", statusTone),
    format: formatPerMin,
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
    id: "snapshot-refresh",
    title: "Snapshot refreshes",
    subtitle: "Runs per minute by result",
    queries: [`sum by (result) (rate(${REFRESH}[5m])) * 60`],
    toSeries: splitByLabel(`sum by (result) (rate(${REFRESH}[5m])) * 60`, "result", resultTone),
    format: formatPerMin,
  },
];

export const JOBS_PANELS: PanelDef[] = [
  {
    id: "snapshot-success-rate",
    title: "Snapshot success rate",
    subtitle: "Success ratio over 3h, by snapshot",
    queries: [
      `sum by (snapshot) (rate(${REFRESH}{result="success"}[3h])) / clamp_min(sum by (snapshot) (rate(${REFRESH}[3h])), 0.0001)`,
    ],
    toSeries: splitByLabel(
      `sum by (snapshot) (rate(${REFRESH}{result="success"}[3h])) / clamp_min(sum by (snapshot) (rate(${REFRESH}[3h])), 0.0001)`,
      "snapshot",
      (v) => (v.includes("slack") ? "accent" : "ink")
    ),
    format: formatPercent,
    zeroBaseline: true,
    forceFrom: "now-24h",
  },
  {
    id: "upstream-429",
    title: "Slack upstream 429s",
    subtitle: "Rate-limit responses per minute",
    queries: [`sum(rate(${UPSTREAM}{status_code="429"}[5m])) * 60`],
    toSeries: single(`sum(rate(${UPSTREAM}{status_code="429"}[5m])) * 60`, "429/min", "neg"),
    format: formatPerMin,
    area: true,
    zeroBaseline: true,
    forceFrom: "now-24h",
  },
  {
    id: "cron-staleness",
    title: "Time since last schedule",
    subtitle: "Oldest CronJob in namespace",
    queries: [
      `max(time() - kube_cronjob_status_last_schedule_time{namespace="makeacompany-ai"})`,
    ],
    toSeries: single(
      `max(time() - kube_cronjob_status_last_schedule_time{namespace="makeacompany-ai"})`,
      "staleness",
      "accent"
    ),
    format: formatDuration,
    forceFrom: "now-24h",
  },
];

export const CLUSTER_PANELS: PanelDef[] = [
  {
    id: "container-restarts",
    title: "Container restarts",
    subtitle: "Restarts per hour in namespace",
    queries: [
      `sum(increase(kube_pod_container_status_restarts_total{namespace="makeacompany-ai"}[1h]))`,
    ],
    toSeries: single(
      `sum(increase(kube_pod_container_status_restarts_total{namespace="makeacompany-ai"}[1h]))`,
      "restarts",
      "neg"
    ),
    format: formatCompact,
    area: true,
    zeroBaseline: true,
    forceFrom: "now-24h",
  },
  {
    id: "pods-running",
    title: "Pods running",
    subtitle: "Running pods in namespace",
    queries: [
      `count(kube_pod_status_phase{namespace="makeacompany-ai", phase="Running"} == 1)`,
    ],
    toSeries: single(
      `count(kube_pod_status_phase{namespace="makeacompany-ai", phase="Running"} == 1)`,
      "pods",
      "ink"
    ),
    format: formatCompact,
    forceFrom: "now-24h",
  },
];

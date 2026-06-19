import type { ChartSeries, ChartTone } from "./charts/time-series-chart";
import type { RangeSeries } from "./charts/use-range-query";
import {
  formatBytes,
  formatCompact,
  formatCores,
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
const UPSTREAM_ALL = "makeacompany_slack_upstream_http_status_total";
const REAPER_SCANNED = "makeacompany_trial_expiry_reaper_scanned_total";
const REAPER_ENQUEUED = "makeacompany_trial_expiry_reaper_enqueued_total";
const CRONJOB = "makeacompany_cronjob_duration_seconds_count";
const LIFECYCLE = "makeacompany_lifecycle_users";
const INSTALL_CLICK = "makeacompany_install_click_total";
const OAUTH_CALLBACK = "makeacompany_oauth_callback_total";
const FIRST_MESSAGE = "makeacompany_first_message_total";
const TRIAL_START = "makeacompany_trial_start_total";

const statusTone = (cls: string): ChartTone =>
  cls.startsWith("2") ? "pos" : cls.startsWith("5") ? "neg" : cls.startsWith("4") ? "accent" : "muted";

// 429 surfaces separately from generic 4xx since rate-limits are the actionable signal.
const statusCodeTone = (code: string): ChartTone => {
  if (code === "429") return "neg";
  if (code.startsWith("5")) return "ink";
  if (code.startsWith("4")) return "accent";
  if (code.startsWith("2")) return "pos";
  return "muted";
};

const SOURCE_PALETTE: ChartTone[] = ["neg", "accent", "ink", "muted", "pos"];

const resultTone = (r: string): ChartTone => (r === "success" ? "pos" : "neg");

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

export const JOBS_PANELS: PanelDef[] = [
  {
    id: "snapshot-refresh",
    title: "Snapshot refreshes",
    subtitle: "Runs per minute by result",
    queries: [`sum by (result) (rate(${REFRESH}[5m])) * 60`],
    toSeries: splitByLabel(`sum by (result) (rate(${REFRESH}[5m])) * 60`, "result", resultTone),
    format: formatPerMin,
  },
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
  },
  {
    id: "upstream-429",
    title: "Slack upstream 429s",
    subtitle: "Rate-limit responses per minute (refresh path)",
    queries: [`sum(rate(${UPSTREAM}{status_code="429"}[5m])) * 60`],
    toSeries: single(`sum(rate(${UPSTREAM}{status_code="429"}[5m])) * 60`, "429/min", "neg"),
    format: formatPerMin,
    area: true,
    zeroBaseline: true,
    hideWhenEmpty: true,
  },
  {
    id: "slack-upstream-status",
    title: "Slack API status mix",
    subtitle: "All upstream Slack calls /min, split by status",
    queries: [`sum by (status_code) (rate(${UPSTREAM_ALL}[5m])) * 60`],
    toSeries: splitByLabel(
      `sum by (status_code) (rate(${UPSTREAM_ALL}[5m])) * 60`,
      "status_code",
      statusCodeTone
    ),
    format: formatPerMin,
    area: true,
    zeroBaseline: true,
    hideWhenEmpty: true,
    span: 2,
  },
  {
    id: "slack-upstream-429-by-source",
    title: "Slack 429s by call-site",
    subtitle: "Which upstream operation is getting throttled",
    queries: [
      `sum by (source) (rate(${UPSTREAM_ALL}{status_code="429"}[5m])) * 60`,
    ],
    toSeries: (raw) =>
      raw
        .filter(
          (s) =>
            s.query === `sum by (source) (rate(${UPSTREAM_ALL}{status_code="429"}[5m])) * 60` &&
            s.labels.source
        )
        .sort((a, b) => {
          const lastA = a.points.at(-1)?.[1] ?? 0;
          const lastB = b.points.at(-1)?.[1] ?? 0;
          return lastB - lastA;
        })
        .map((s, i) => ({
          key: `source-${s.labels.source}`,
          label: s.labels.source,
          tone: SOURCE_PALETTE[i % SOURCE_PALETTE.length],
          points: s.points,
        })),
    format: formatPerMin,
    zeroBaseline: true,
    hideWhenEmpty: true,
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
  },
  {
    id: "trial-expiry-reaper-runs",
    title: "Trial-expiry reaper runs",
    subtitle: "Success vs error /hour (cron fires every 10m)",
    queries: [`sum by (result) (increase(${CRONJOB}{job="trial-expiry-reaper"}[1h]))`],
    toSeries: splitByLabel(
      `sum by (result) (increase(${CRONJOB}{job="trial-expiry-reaper"}[1h]))`,
      "result",
      resultTone
    ),
    format: formatCompact,
  },
  {
    id: "trial-expiry-reaper-flow",
    title: "Trial-expiry reaper flow",
    subtitle: "Profiles scanned vs DMs enqueued /hour",
    queries: [
      `increase(${REAPER_SCANNED}[1h])`,
      `increase(${REAPER_ENQUEUED}[1h])`,
    ],
    toSeries: perQuery([
      { query: `increase(${REAPER_SCANNED}[1h])`, label: "scanned", tone: "muted" },
      { query: `increase(${REAPER_ENQUEUED}[1h])`, label: "enqueued", tone: "accent" },
    ]),
    format: formatCompact,
    hideWhenEmpty: true,
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

const oauthOutcomeTone = (outcome: string): ChartTone =>
  outcome === "success" ? "pos" : outcome === "denied" ? "muted" : "neg";

const botTone = (bot: string): ChartTone => (bot === "ross" ? "ink" : "accent");

export const FUNNEL_PANELS: PanelDef[] = [
  {
    id: "funnel-install-clicks",
    title: "Install clicks /day",
    subtitle: "CheckoutButton submissions, split by first-touch source",
    queries: [`sum by (source) (increase(${INSTALL_CLICK}[1d]))`],
    toSeries: splitByLabel(
      `sum by (source) (increase(${INSTALL_CLICK}[1d]))`,
      "source",
      (s) => (s === "" ? "muted" : "ink"),
      (s) => (s === "" ? "direct/unknown" : s),
    ),
    format: formatCompact,
    area: true,
    zeroBaseline: true,
    span: 2,
    hideWhenEmpty: true,
  },
  {
    id: "funnel-oauth-callbacks",
    title: "OAuth installs /day",
    subtitle: "Personal-agent install-complete outcomes",
    queries: [`sum by (outcome) (increase(${OAUTH_CALLBACK}[1d]))`],
    toSeries: splitByLabel(
      `sum by (outcome) (increase(${OAUTH_CALLBACK}[1d]))`,
      "outcome",
      oauthOutcomeTone,
    ),
    format: formatCompact,
    zeroBaseline: true,
    hideWhenEmpty: true,
  },
  {
    id: "funnel-first-messages",
    title: "First messages /day",
    subtitle: "Users whose first ingested message landed, by bot",
    queries: [`sum by (bot) (increase(${FIRST_MESSAGE}[1d]))`],
    toSeries: splitByLabel(
      `sum by (bot) (increase(${FIRST_MESSAGE}[1d]))`,
      "bot",
      botTone,
    ),
    format: formatCompact,
    zeroBaseline: true,
    hideWhenEmpty: true,
  },
  {
    id: "funnel-trial-starts",
    title: "Trial starts /day",
    subtitle: "Profiles flipped into trialing past the seat cap, by attribution",
    queries: [`sum by (attributed_to) (increase(${TRIAL_START}[1d]))`],
    toSeries: splitByLabel(
      `sum by (attributed_to) (increase(${TRIAL_START}[1d]))`,
      "attributed_to",
      (s) => (s === "" ? "muted" : "accent"),
      (s) => (s === "" ? "direct/unknown" : s),
    ),
    format: formatCompact,
    zeroBaseline: true,
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

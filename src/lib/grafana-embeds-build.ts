type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
  source: "twitter" | "app" | "cron";
};

const defaultTwitterPanelTitles = ["Indexer throughput", "Worker throughput"];
const defaultAdminPanelTitles = [
  "Requests /min",
  "P95 latency",
  "Inbound events by agent",
  "Activities",
  "JetStream publish /s",
  "Worker orchestrator ingress",
  "Orchestrator Socket Mode",
  "Backend HTTP errors/min",
];

export const DEFAULT_GRAFANA_DASHBOARD_PATH =
  "/grafana/d/makeacompany-observability/makeacompany-observability?orgId=1";
const DEFAULT_SLACK_ORCHESTRATOR_PATH =
  "/grafana/d/makeacompany-slack-orchestrator/makeacompany-slack-orchestrator?orgId=1";
const DEFAULT_AGENTS_PATH = "/grafana/d/makeacompany-agents/makeacompany-agents?orgId=1";
/** K8s CronJob / Job panels (kube-state or app metrics). Provision this dashboard in Grafana, then align panel ids via env. */
const DEFAULT_CRON_PATH = "/grafana/d/makeacompany-cronjobs/makeacompany-cronjobs?orgId=1";

const defaultSlackOrchestratorPanelTitles = [
  "Events API acks /s",
  "JetStream publish /s",
  "Publish latency p95",
  "Socket Mode state",
];

const defaultAgentsPanelTitles = ["Activities", "All agents (goroutines)"];

const defaultCronPanelTitles = [
  "CronJob — last schedule / next run",
  "Job success vs failure (by CronJob)",
  "Job or pod run duration",
];

function buildDefaultGrafanaDashboardUrl(
  requestHost: string | null,
  requestProto: string | null
): string | null {
  return buildDefaultGrafanaPathUrl(requestHost, requestProto, DEFAULT_GRAFANA_DASHBOARD_PATH);
}

/**
 * When no HEALTH_GRAFANA_* URL is set, supplies a dashboard base for Grafana iframes.
 * Loopback hosts return null unless HEALTH_GRAFANA_LOCAL_BASE_URL is set (origin only, e.g.
 * http://127.0.0.1:13000 after kubectl port-forward or docker compose k8s-grafana-forward).
 * That avoids embedding prod metrics by accident while still allowing local forwards without
 * pasting full HEALTH_GRAFANA_DASHBOARD_URL paths.
 */
function loopbackGrafanaOrigin(): string | null {
  const raw = process.env.HEALTH_GRAFANA_LOCAL_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

function buildDefaultGrafanaPathUrl(
  requestHost: string | null,
  requestProto: string | null,
  pathWithQuery: string
): string | null {
  const hostOnly = requestHost?.split(",")[0]?.trim() || "";
  const proto = requestProto?.split(",")[0]?.trim();
  const normalizedProto = proto === "http" || proto === "https" ? proto : "https";
  const hostname = hostOnly.split(":")[0]?.trim().toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    const origin = loopbackGrafanaOrigin();
    if (!origin) {
      return null;
    }
    try {
      return new URL(pathWithQuery, origin).toString();
    } catch {
      return null;
    }
  }

  if (!hostOnly) {
    return `https://makeacompany.ai${pathWithQuery}`;
  }

  return `${normalizedProto}://${hostOnly}${pathWithQuery}`;
}

function normalizeGrafanaDashboardUrl(
  configured: string | null,
  requestHost: string | null,
  requestProto: string | null
): string | null {
  if (!configured) {
    return null;
  }
  const hostOnly = requestHost?.split(",")[0]?.trim();
  const hostname = hostOnly?.split(":")[0];
  if (!hostname || !/^(www\.)?makeacompany\.ai$/i.test(hostname)) {
    return configured;
  }
  try {
    const url = new URL(configured);
    url.hostname = hostname;
    const proto = requestProto?.split(",")[0]?.trim();
    if (proto === "http" || proto === "https") {
      url.protocol = `${proto}:`;
    }
    return url.toString();
  } catch {
    return configured;
  }
}

function parseList(value: string | null | undefined, fallback: string[]): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
}

function buildGrafanaEmbeds(
  dashboardUrl: string | null,
  source: "twitter" | "app" | "cron",
  panelIds: string[],
  panelTitles: string[]
): GrafanaEmbed[] {
  return panelIds.map((panelId, idx) => ({
    key: `${source}-${panelId}`,
    panelId,
    title: panelTitles[idx] ?? `Panel ${panelId}`,
    dashboardUrl,
    source,
  }));
}

/**
 * Public-safe Grafana embed metadata (iframe targets, panel ids) for a request host.
 * No backend credentials or internal API URLs.
 */
export function buildGrafanaHealthEmbeds(
  requestHost: string | null,
  requestProto: string | null
): {
  grafanaDashboardUrl: string | null;
  twitterGrafanaDashboardUrl: string | null;
  slackOrchestratorGrafanaDashboardUrl: string | null;
  agentsGrafanaDashboardUrl: string | null;
  cronjobGrafanaDashboardUrl: string | null;
  grafanaEmbeds: GrafanaEmbed[];
  adminGrafanaEmbeds: GrafanaEmbed[];
  slackOrchestratorGrafanaEmbeds: GrafanaEmbed[];
  agentsGrafanaEmbeds: GrafanaEmbed[];
  cronjobGrafanaEmbeds: GrafanaEmbed[];
} {
  const configuredDashboardUrl = process.env.HEALTH_GRAFANA_DASHBOARD_URL?.trim() || null;
  const grafanaDashboardUrl =
    normalizeGrafanaDashboardUrl(configuredDashboardUrl, requestHost, requestProto) ??
    buildDefaultGrafanaDashboardUrl(requestHost, requestProto);
  const twitterDashboardUrl =
    normalizeGrafanaDashboardUrl(
      process.env.HEALTH_GRAFANA_TWITTER_DASHBOARD_URL?.trim() || configuredDashboardUrl,
      requestHost,
      requestProto
    ) ?? grafanaDashboardUrl;

  const twitterPanelIds = parseList(process.env.HEALTH_GRAFANA_TWITTER_PANEL_IDS, ["1", "3"]);
  const twitterPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_TWITTER_PANEL_TITLES,
    defaultTwitterPanelTitles
  );
  const adminPanelIds = parseList(process.env.HEALTH_GRAFANA_ADMIN_PANEL_IDS, [
    "1",
    "2",
    "3",
    "4",
    "9",
    "10",
    "11",
    "8",
  ]);
  const adminPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_ADMIN_PANEL_TITLES,
    defaultAdminPanelTitles
  );

  const slackOrchestratorConfigured = process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_DASHBOARD_URL?.trim() || null;
  const slackOrchestratorDashboardUrl =
    normalizeGrafanaDashboardUrl(slackOrchestratorConfigured, requestHost, requestProto) ??
    buildDefaultGrafanaPathUrl(requestHost, requestProto, DEFAULT_SLACK_ORCHESTRATOR_PATH);
  const slackOrchestratorPanelIds = parseList(
    process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_IDS,
    ["1", "2", "3", "4"]
  );
  const slackOrchestratorPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_TITLES,
    defaultSlackOrchestratorPanelTitles
  );

  const agentsConfigured = process.env.HEALTH_GRAFANA_AGENTS_DASHBOARD_URL?.trim() || null;
  const agentsDashboardUrl =
    normalizeGrafanaDashboardUrl(agentsConfigured, requestHost, requestProto) ??
    buildDefaultGrafanaPathUrl(requestHost, requestProto, DEFAULT_AGENTS_PATH);
  const agentsPanelIds = parseList(process.env.HEALTH_GRAFANA_AGENTS_PANEL_IDS, ["1", "2"]);
  const agentsPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_AGENTS_PANEL_TITLES,
    defaultAgentsPanelTitles
  );

  const cronjobConfigured = process.env.HEALTH_GRAFANA_CRON_DASHBOARD_URL?.trim() || null;
  const cronjobDashboardUrl =
    normalizeGrafanaDashboardUrl(cronjobConfigured, requestHost, requestProto) ??
    buildDefaultGrafanaPathUrl(requestHost, requestProto, DEFAULT_CRON_PATH);
  const cronjobPanelIds = parseList(process.env.HEALTH_GRAFANA_CRON_PANEL_IDS, ["1", "2", "3"]);
  const cronjobPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_CRON_PANEL_TITLES,
    defaultCronPanelTitles
  );

  const grafanaEmbeds = buildGrafanaEmbeds(
    twitterDashboardUrl,
    "twitter",
    twitterPanelIds,
    twitterPanelTitles
  );
  const adminGrafanaEmbeds = buildGrafanaEmbeds(
    grafanaDashboardUrl,
    "app",
    adminPanelIds,
    adminPanelTitles
  );
  const slackOrchestratorGrafanaEmbeds = buildGrafanaEmbeds(
    slackOrchestratorDashboardUrl,
    "app",
    slackOrchestratorPanelIds,
    slackOrchestratorPanelTitles
  );
  const agentsGrafanaEmbeds = buildGrafanaEmbeds(
    agentsDashboardUrl,
    "app",
    agentsPanelIds,
    agentsPanelTitles
  );
  const cronjobGrafanaEmbeds = buildGrafanaEmbeds(
    cronjobDashboardUrl,
    "cron",
    cronjobPanelIds,
    cronjobPanelTitles
  );

  return {
    grafanaDashboardUrl,
    twitterGrafanaDashboardUrl: twitterDashboardUrl,
    slackOrchestratorGrafanaDashboardUrl: slackOrchestratorDashboardUrl,
    agentsGrafanaDashboardUrl: agentsDashboardUrl,
    cronjobGrafanaDashboardUrl: cronjobDashboardUrl,
    grafanaEmbeds,
    adminGrafanaEmbeds,
    slackOrchestratorGrafanaEmbeds,
    agentsGrafanaEmbeds,
    cronjobGrafanaEmbeds,
  };
}

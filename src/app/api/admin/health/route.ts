import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
  source: "twitter" | "app";
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

const DEFAULT_GRAFANA_DASHBOARD_PATH =
  "/grafana/d/makeacompany-observability/makeacompany-observability?orgId=1";
const DEFAULT_SLACK_ORCHESTRATOR_PATH =
  "/grafana/d/makeacompany-slack-orchestrator/makeacompany-slack-orchestrator?orgId=1";
const DEFAULT_AGENTS_PATH = "/grafana/d/makeacompany-agents/makeacompany-agents?orgId=1";

const defaultSlackOrchestratorPanelTitles = [
  "Events API acks /s",
  "JetStream publish /s",
  "Publish latency p95",
  "Socket Mode state",
];

const defaultAgentsPanelTitles = [
  "Inbound events /min by agent",
  "Outbound posts /min by agent",
  "Orchestrator ingress accepted /s",
  "Go goroutines",
];

function buildDefaultGrafanaDashboardUrl(
  requestHost: string | null,
  requestProto: string | null
): string | null {
  return buildDefaultGrafanaPathUrl(requestHost, requestProto, DEFAULT_GRAFANA_DASHBOARD_PATH);
}

/**
 * When no HEALTH_GRAFANA_* URL is set, supplies a dashboard base for Grafana iframes.
 * Loopback hosts return null so local dev does not embed prod (makeacompany.ai) metrics by default.
 * Set HEALTH_GRAFANA_*_URL explicitly to a Grafana base URL (e.g. after kubectl port-forward) to see charts locally.
 */
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
    return null;
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
  source: "twitter" | "app",
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

export async function GET() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";

  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  const backendBase =
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase;
  const backendHealthURL = `${backendBase.replace(/\/$/, "")}/health`;
  const backendIndexerRequestsURL = `${backendBase.replace(/\/$/, "")}/api/internal/indexer-recent-requests?limit=100&offset=0`;

  const configuredDashboardUrl = process.env.HEALTH_GRAFANA_DASHBOARD_URL?.trim() || null;
  const grafanaDashboardUrl =
    normalizeGrafanaDashboardUrl(configuredDashboardUrl, host, proto) ??
    buildDefaultGrafanaDashboardUrl(host, proto);
  const twitterDashboardUrl =
    normalizeGrafanaDashboardUrl(
      process.env.HEALTH_GRAFANA_TWITTER_DASHBOARD_URL?.trim() || configuredDashboardUrl,
      host,
      proto
    ) ?? grafanaDashboardUrl;

  const twitterPanelIds = parseList(process.env.HEALTH_GRAFANA_TWITTER_PANEL_IDS, ["1", "3"]);
  const twitterPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_TWITTER_PANEL_TITLES,
    defaultTwitterPanelTitles
  );
  const adminPanelIds = parseList(process.env.HEALTH_GRAFANA_ADMIN_PANEL_IDS, ["1", "2", "3", "4", "9", "10", "11", "8"]);
  const adminPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_ADMIN_PANEL_TITLES,
    defaultAdminPanelTitles
  );

  const slackOrchestratorConfigured = process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_DASHBOARD_URL?.trim() || null;
  const slackOrchestratorDashboardUrl =
    normalizeGrafanaDashboardUrl(slackOrchestratorConfigured, host, proto) ??
    buildDefaultGrafanaPathUrl(host, proto, DEFAULT_SLACK_ORCHESTRATOR_PATH);
  const slackOrchestratorPanelIds = parseList(process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_IDS, ["1", "2", "3", "4"]);
  const slackOrchestratorPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_SLACK_ORCHESTRATOR_PANEL_TITLES,
    defaultSlackOrchestratorPanelTitles
  );

  const agentsConfigured = process.env.HEALTH_GRAFANA_AGENTS_DASHBOARD_URL?.trim() || null;
  const agentsDashboardUrl =
    normalizeGrafanaDashboardUrl(agentsConfigured, host, proto) ?? buildDefaultGrafanaPathUrl(host, proto, DEFAULT_AGENTS_PATH);
  const agentsPanelIds = parseList(process.env.HEALTH_GRAFANA_AGENTS_PANEL_IDS, ["1", "2", "3", "4"]);
  const agentsPanelTitles = parseList(process.env.HEALTH_GRAFANA_AGENTS_PANEL_TITLES, defaultAgentsPanelTitles);

  // `/twitter` uses only these embeds; `/employees` team cards use `adminGrafanaEmbeds` (employee-factory metrics only).
  const grafanaEmbeds = buildGrafanaEmbeds(twitterDashboardUrl, "twitter", twitterPanelIds, twitterPanelTitles);
  const adminGrafanaEmbeds = buildGrafanaEmbeds(grafanaDashboardUrl, "app", adminPanelIds, adminPanelTitles);
  const slackOrchestratorGrafanaEmbeds = buildGrafanaEmbeds(
    slackOrchestratorDashboardUrl,
    "app",
    slackOrchestratorPanelIds,
    slackOrchestratorPanelTitles
  );
  const agentsGrafanaEmbeds = buildGrafanaEmbeds(agentsDashboardUrl, "app", agentsPanelIds, agentsPanelTitles);

  try {
    const [response, recentRequestsResponse] = await Promise.all([
      fetch(backendHealthURL, { cache: "no-store" }),
      fetch(backendIndexerRequestsURL, { cache: "no-store" }),
    ]);
    const payload = await response.json().catch(() => ({
      status: "degraded",
      error: "invalid backend health response",
    }));
    const recentRequestsPayload = await recentRequestsResponse
      .json()
      .catch(() => ({ status: "degraded", requests: [] }));
    const recentRequests = Array.isArray(recentRequestsPayload?.requests)
      ? recentRequestsPayload.requests
      : [];

    return NextResponse.json(
      {
        ...payload,
        recentRequests,
        checkedAt: new Date().toISOString(),
        backendHealthURL,
        backendIndexerRequestsURL,
        grafanaDashboardUrl,
        twitterGrafanaDashboardUrl: twitterDashboardUrl,
        slackOrchestratorGrafanaDashboardUrl: slackOrchestratorDashboardUrl,
        agentsGrafanaDashboardUrl: agentsDashboardUrl,
        grafanaEmbeds,
        adminGrafanaEmbeds,
        slackOrchestratorGrafanaEmbeds,
        agentsGrafanaEmbeds,
      },
      { status: response.ok ? 200 : 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        status: "degraded",
        error: `health proxy failed: ${message}`,
        checkedAt: new Date().toISOString(),
        backendHealthURL,
        backendIndexerRequestsURL,
        grafanaDashboardUrl,
        twitterGrafanaDashboardUrl: twitterDashboardUrl,
        slackOrchestratorGrafanaDashboardUrl: slackOrchestratorDashboardUrl,
        agentsGrafanaDashboardUrl: agentsDashboardUrl,
        grafanaEmbeds,
        adminGrafanaEmbeds,
        slackOrchestratorGrafanaEmbeds,
        agentsGrafanaEmbeds,
      },
      { status: 502 }
    );
  }
}

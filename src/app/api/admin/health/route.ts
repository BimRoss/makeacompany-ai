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

const defaultPanelTitles = ["Activities", "Requests /min", "Tool usage"];
const defaultTwitterPanelTitles = ["Indexer throughput", "Worker throughput"];

const DEFAULT_GRAFANA_DASHBOARD_PATH =
  "/grafana/d/makeacompany-observability/makeacompany-observability?orgId=1";

function buildDefaultGrafanaDashboardUrl(requestHost: string | null, requestProto: string | null): string {
  const hostOnly = requestHost?.split(",")[0]?.trim() || "";
  const proto = requestProto?.split(",")[0]?.trim();
  const normalizedProto = proto === "http" || proto === "https" ? proto : "https";
  const hostname = hostOnly.split(":")[0]?.trim().toLowerCase();

  // Local docker/dev does not route /grafana; use production ingress URL.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return `https://makeacompany.ai${DEFAULT_GRAFANA_DASHBOARD_PATH}`;
  }

  if (!hostOnly) {
    return `https://makeacompany.ai${DEFAULT_GRAFANA_DASHBOARD_PATH}`;
  }

  return `${normalizedProto}://${hostOnly}${DEFAULT_GRAFANA_DASHBOARD_PATH}`;
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

  const panelIds = parseList(process.env.HEALTH_GRAFANA_PANEL_IDS, ["4", "1", "7"]);
  const panelTitles = parseList(process.env.HEALTH_GRAFANA_PANEL_TITLES, defaultPanelTitles);
  const twitterPanelIds = parseList(process.env.HEALTH_GRAFANA_TWITTER_PANEL_IDS, ["1", "3"]);
  const twitterPanelTitles = parseList(
    process.env.HEALTH_GRAFANA_TWITTER_PANEL_TITLES,
    defaultTwitterPanelTitles
  );
  const grafanaEmbeds = [
    ...buildGrafanaEmbeds(twitterDashboardUrl, "twitter", twitterPanelIds, twitterPanelTitles),
    ...buildGrafanaEmbeds(grafanaDashboardUrl, "app", panelIds, panelTitles),
  ];

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
        grafanaEmbeds,
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
        grafanaEmbeds,
      },
      { status: 502 }
    );
  }
}

import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
};

const defaultPanelTitles = [
  "Requests per minute",
  "P95 request latency",
  "Inbound events/min by agent",
  "Go goroutines",
  "Backend memory RSS",
  "Outbound posts/min by agent",
];

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
  panelIds: string[],
  panelTitles: string[]
): GrafanaEmbed[] {
  return panelIds.map((panelId, idx) => ({
    key: `panel-${panelId}`,
    panelId,
    title: panelTitles[idx] ?? `Panel ${panelId}`,
    dashboardUrl,
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

  const grafanaDashboardUrl = normalizeGrafanaDashboardUrl(
    process.env.HEALTH_GRAFANA_DASHBOARD_URL?.trim() || null,
    host,
    proto
  );
  const panelIds = parseList(process.env.HEALTH_GRAFANA_PANEL_IDS, ["1", "2", "3", "4", "5", "6"]);
  const panelTitles = parseList(process.env.HEALTH_GRAFANA_PANEL_TITLES, defaultPanelTitles);
  const grafanaEmbeds = buildGrafanaEmbeds(grafanaDashboardUrl, panelIds, panelTitles);

  try {
    const response = await fetch(backendHealthURL, { cache: "no-store" });
    const payload = await response.json().catch(() => ({
      status: "degraded",
      error: "invalid backend health response",
    }));
    return NextResponse.json(
      {
        ...payload,
        checkedAt: new Date().toISOString(),
        backendHealthURL,
        grafanaDashboardUrl,
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
        grafanaDashboardUrl,
        grafanaEmbeds,
      },
      { status: 502 }
    );
  }
}

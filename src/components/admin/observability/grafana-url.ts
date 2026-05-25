/**
 * Shared helper to build a Grafana iframe URL (solo panel) and a deep-link URL
 * (full dashboard) for an embed. Centralized here so the dashboard sections,
 * per-panel "open in Grafana" links, and any future panels all stay in sync.
 */
export type GrafanaEmbedTheme = "light" | "dark";

function toSoloPath(pathname: string): string {
  if (pathname.startsWith("/grafana/d/")) {
    return pathname.replace(/^\/grafana\/d\//, "/grafana/d-solo/");
  }
  if (pathname.startsWith("/d/")) {
    return pathname.replace(/^\/d\//, "/d-solo/");
  }
  return pathname;
}

export function asGrafanaSoloEmbedUrl(
  value: string | null | undefined,
  panelId: string,
  theme: GrafanaEmbedTheme,
  from: string
): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    url.pathname = toSoloPath(url.pathname);
    url.searchParams.set("orgId", url.searchParams.get("orgId") ?? "1");
    url.searchParams.set("theme", theme);
    url.searchParams.set("from", from);
    url.searchParams.set("to", "now");
    url.searchParams.set("refresh", "30s");
    url.searchParams.set("panelId", panelId);
    url.searchParams.set("kiosk", "1");
    return url.toString();
  } catch {
    return null;
  }
}

/** Full-dashboard deep link (not d-solo). Used for the per-panel "open in Grafana ↗". */
export function asGrafanaDashboardDeepLink(
  value: string | null | undefined,
  panelId: string,
  from: string
): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    url.searchParams.set("orgId", url.searchParams.get("orgId") ?? "1");
    url.searchParams.set("from", from);
    url.searchParams.set("to", "now");
    url.searchParams.set("viewPanel", panelId);
    return url.toString();
  } catch {
    return null;
  }
}

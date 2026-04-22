/**
 * Whether the browser is on a loopback host where Grafana embed URLs are
 * intentionally omitted unless HEALTH_GRAFANA_LOCAL_BASE_URL / *_DASHBOARD_URL is set.
 */
export function isBrowserLoopbackHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const h = window.location.hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

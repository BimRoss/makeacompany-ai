/**
 * Parses `Host` / `X-Forwarded-Host` values (e.g. `localhost:3000`, `[::1]:3000`).
 * Safe in Server Components and Route Handlers.
 */
export function requestHostLooksLoopback(hostHeader: string): boolean {
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  let hostname: string;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    hostname = end > 1 ? raw.slice(1, end) : raw;
  } else {
    hostname = raw.split(":")[0] ?? raw;
  }
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

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

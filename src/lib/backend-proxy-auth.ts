import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { portalSessionCookieName } from "@/lib/portal-session-cookies";

const adminSessionCookieName = "mac_admin_session";

export { portalChannelCookieName, portalSessionCookieName } from "@/lib/portal-session-cookies";

export function resolveBackendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  // Default host port matches docker-compose BACKEND_PORT (8090), not slack-orchestrator (8080).
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8090";
  return (
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase
  );
}

/**
 * Bearer from admin session cookie only (for `/api/admin/*` browser requests).
 */
export async function resolveAdminSessionBearerToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value?.trim();
  return token || null;
}

/** Authorization header for Next.js → Go `/v1/admin/*` proxies (admin session cookie only). */
export async function backendProxyAuthHeaders(): Promise<HeadersInit> {
  const token = await resolveAdminSessionBearerToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Bearer from portal session cookie only (for `/api/portal/*` → company channel + knowledge). */
export async function portalProxyAuthHeaders(): Promise<HeadersInit> {
  const cookieStore = await cookies();
  const token = cookieStore.get(portalSessionCookieName)?.value?.trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Parse a backend response as JSON; many Go handlers use http.Error (plain text) on failure.
 */
export async function parseBackendProxyBody(response: Response): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return { error: `empty response (HTTP ${response.status})` };
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const line = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
    return { error: line.slice(0, 4000) };
  }
}

const proxyJsonNoStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/** JSON from admin API proxies — never cache (avoids stale empty snapshot after a live refresh). */
export function adminProxyNextJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: proxyJsonNoStoreHeaders });
}

/** Same cache semantics as admin proxies; use for portal API JSON. */
export function portalProxyNextJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: proxyJsonNoStoreHeaders });
}

/** Rejects requests without a valid admin session. Use on API routes that do not proxy `/v1/admin/*`. */
export async function requireAdminApiSession(): Promise<NextResponse | null> {
  const token = await resolveAdminSessionBearerToken();
  if (!token) {
    return adminProxyNextJson({ error: "unauthorized" }, 401);
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/me`;
  try {
    const response = await fetch(backendURL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) {
      return null;
    }
    return adminProxyNextJson({ error: "unauthorized" }, 401);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `session verification failed: ${message}` }, 502);
  }
}

/** Rejects requests without a valid portal session (cookie + backend `/v1/portal/auth/me`). */
export async function requirePortalApiSession(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(portalSessionCookieName)?.value?.trim();
  if (!token) {
    return portalProxyNextJson({ error: "unauthorized" }, 401);
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/me`;
  try {
    const response = await fetch(backendURL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) {
      return null;
    }
    return portalProxyNextJson({ error: "unauthorized" }, 401);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return portalProxyNextJson({ error: `session verification failed: ${message}` }, 502);
  }
}

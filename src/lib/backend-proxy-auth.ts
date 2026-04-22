import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const adminSessionCookieName = "mac_admin_session";

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
 * Prefer BACKEND_INTERNAL_SERVICE_TOKEN for server-to-server API calls when Stripe sessions are not used.
 * Falls back to the legacy mac_admin_session cookie when present.
 */
export async function resolveBackendBearerToken(): Promise<string | null> {
  const internal = process.env.BACKEND_INTERNAL_SERVICE_TOKEN?.trim();
  if (internal) return internal;
  const cookieStore = await cookies();
  return cookieStore.get(adminSessionCookieName)?.value ?? null;
}

/** Authorization header for Next.js → backend admin proxies (internal token and/or mac_admin_session). */
export async function backendProxyAuthHeaders(): Promise<HeadersInit> {
  const token = await resolveBackendBearerToken();
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

const adminNoStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/** JSON from admin API proxies — never cache (avoids stale empty snapshot after a live refresh). */
export function adminProxyNextJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: adminNoStoreHeaders });
}

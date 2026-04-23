import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const adminSessionCookieName = "mac_admin_session";

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/$/, "");
  return trimmed.replace(/^0\.0\.0\.0(?=[:/]|$)/, "localhost");
}

function resolvePublicOrigin(request: Request): string {
  const reqURL = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = normalizeHost(request.headers.get("x-forwarded-host")?.split(",")[0] ?? "");
  const host = normalizeHost(request.headers.get("host") ?? "");
  const protocol = forwardedProto || reqURL.protocol.replace(":", "");

  if (forwardedHost) {
    return `${protocol}://${forwardedHost}`;
  }
  if (host) {
    return `${protocol}://${host}`;
  }

  if (reqURL.hostname === "0.0.0.0") {
    const fallbackBase = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_BASE_URL;
    if (fallbackBase) {
      return new URL(fallbackBase).origin;
    }
    return "http://localhost:3000";
  }
  return reqURL.origin;
}

function resolveBackendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  return (
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase
  );
}

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secureCookies = (forwardedProto || reqURL.protocol.replace(":", "")) === "https";
  const sessionID = reqURL.searchParams.get("session_id")?.trim();
  if (!sessionID) {
    return NextResponse.redirect(new URL("/admin/login?auth=failed", origin));
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/finish?session_id=${encodeURIComponent(sessionID)}`;
  try {
    const response = await fetch(backendURL, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | { sessionToken?: string; expiresAt?: string }
      | null;
    if (!response.ok || !payload?.sessionToken) {
      return NextResponse.redirect(new URL("/admin/login?auth=failed", origin));
    }

    const redirectResponse = NextResponse.redirect(new URL("/admin", origin));
    const expires = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
    redirectResponse.cookies.set(adminSessionCookieName, payload.sessionToken, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      expires,
    });
    return redirectResponse;
  } catch {
    return NextResponse.redirect(new URL("/admin/login?auth=failed", origin));
  }
}

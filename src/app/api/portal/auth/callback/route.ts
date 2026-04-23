import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  portalChannelCookieName,
  portalSessionCookieName,
  portalStripeSigninChannelCookieName,
} from "@/lib/portal-session-cookies";

export const dynamic = "force-dynamic";

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
  const cookieStore = await cookies();
  const sessionID = reqURL.searchParams.get("session_id")?.trim();
  const cidFromQuery = reqURL.searchParams.get("cid")?.trim() ?? "";
  const cidFromCookie = cookieStore.get(portalStripeSigninChannelCookieName)?.value?.trim() ?? "";
  const cid = (cidFromQuery || cidFromCookie).trim();
  const loginBase = cid ? `${origin}/${encodeURIComponent(cid)}/login` : `${origin}/`;

  const clearSigninCookie = (r: NextResponse) => {
    r.cookies.set(portalStripeSigninChannelCookieName, "", {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return r;
  };

  if (!sessionID) {
    return clearSigninCookie(NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin)));
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/finish?session_id=${encodeURIComponent(sessionID)}`;
  try {
    const response = await fetch(backendURL, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | { sessionToken?: string; expiresAt?: string; channelId?: string }
      | null;

    if (response.status === 403) {
      return clearSigninCookie(NextResponse.redirect(new URL(`${loginBase}?auth=unauthorized`, origin)));
    }
    if (!response.ok || !payload?.sessionToken || !payload.channelId) {
      return clearSigninCookie(NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin)));
    }

    const ch = encodeURIComponent(payload.channelId.trim());
    const redirectResponse = NextResponse.redirect(new URL(`${origin}/${ch}`, origin));
    const expires = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
    const cookieOpts = {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax" as const,
      path: "/",
      expires,
    };
    redirectResponse.cookies.set(portalSessionCookieName, payload.sessionToken, cookieOpts);
    redirectResponse.cookies.set(portalChannelCookieName, payload.channelId.trim(), cookieOpts);
    return clearSigninCookie(redirectResponse);
  } catch {
    return clearSigninCookie(NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin)));
  }
}

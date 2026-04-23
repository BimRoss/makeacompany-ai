import { NextResponse } from "next/server";

import { portalChannelCookieName, portalSessionCookieName } from "@/lib/portal-session-cookies";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { cookieSecureFromRequest, resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const token = reqURL.searchParams.get("token")?.trim() ?? "";
  const cidFromQuery = reqURL.searchParams.get("cid")?.trim() ?? "";

  const loginBase = cidFromQuery ? `${origin}/${encodeURIComponent(cidFromQuery)}/login` : `${origin}/`;

  if (!token) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/magic/finish?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(backendURL, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | { sessionToken?: string; expiresAt?: string; channelId?: string }
      | null;

    if (response.status === 403) {
      return NextResponse.redirect(new URL(`${loginBase}?auth=unauthorized`, origin));
    }
    if (!response.ok || !payload?.sessionToken || !payload.channelId) {
      return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
    }

    const ch = encodeURIComponent(payload.channelId.trim());
    const redirectResponse = NextResponse.redirect(
      new URL(`${origin}/${ch}?portal_welcome=1`, origin),
    );
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
    return redirectResponse;
  } catch {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }
}

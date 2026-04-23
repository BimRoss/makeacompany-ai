import { NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin-session-cookie";
import { portalChannelCookieName, portalSessionCookieName } from "@/lib/portal-session-cookies";
import { parseGoogleOAuthState } from "@/lib/portal-google-oauth-state";
import { cookieSecureFromRequest, resolveBackendBaseURL, resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

function oauthLoginBase(origin: string, parsed: ReturnType<typeof parseGoogleOAuthState>): string {
  if (parsed?.kind === "portal") {
    return `${origin}/${encodeURIComponent(parsed.channelId)}/login`;
  }
  if (parsed?.kind === "admin") {
    return `${origin}/admin/login`;
  }
  return `${origin}/`;
}

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const code = reqURL.searchParams.get("code")?.trim();
  const state = reqURL.searchParams.get("state")?.trim() ?? "";
  const err = reqURL.searchParams.get("error")?.trim();

  const parsed = parseGoogleOAuthState(state);
  const loginBase = oauthLoginBase(origin, parsed);

  if (err || !parsed) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  const redirectUri = `${origin}/api/portal/auth/google/callback`;
  const tokenBody = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  let idToken: string | undefined;
  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
      cache: "no-store",
    });
    const tokJson = (await tokRes.json().catch(() => null)) as { id_token?: string } | null;
    if (!tokRes.ok || !tokJson?.id_token) {
      return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
    }
    idToken = tokJson.id_token;
  } catch {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  if (parsed.kind === "admin") {
    const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/google/finish`;
    try {
      const response = await fetch(backendURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ idToken }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { sessionToken?: string; expiresAt?: string }
        | null;

      if (response.status === 403) {
        return NextResponse.redirect(new URL(`${loginBase}?auth=unauthorized`, origin));
      }
      if (!response.ok || !payload?.sessionToken) {
        return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
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
      return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
    }
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/google/finish`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ idToken, channelId: parsed.channelId }),
    });
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

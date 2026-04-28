import { NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin-session-cookie";
import { parseGoogleOAuthState } from "@/lib/portal-google-oauth-state";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { cookieSecureFromRequest, resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const code = reqURL.searchParams.get("code")?.trim();
  const state = reqURL.searchParams.get("state")?.trim() ?? "";
  const err = reqURL.searchParams.get("error")?.trim();

  const loginBase = `${origin}/admin/login`;

  const parsed = parseGoogleOAuthState(state);
  const okAdmin = parsed?.kind === "admin";

  if (err || !okAdmin) {
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

  const redirectUri = `${origin}/api/admin/auth/google/callback`;
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

    const redirectResponse = NextResponse.redirect(new URL("/admin?admin_welcome=1", origin));
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

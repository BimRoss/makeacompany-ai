import { NextResponse } from "next/server";

import { meSessionCookieName } from "@/lib/me-session-cookies";
import { parseSlackOAuthState } from "@/lib/slack-oauth-state";
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

  const loginBase = `${origin}/me/login`;
  const parsed = parseSlackOAuthState(state);

  if (err || !parsed || parsed.kind !== "me") {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  const redirectUri = `${origin}/api/me/auth/slack/callback`;
  const backendBase = resolveBackendBaseURL().replace(/\/$/, "");

  // Exchange the auth code for a user access token via the backend so the
  // client_secret stays in the Go pod (not duplicated into Next.js env).
  let slackUserAccessToken: string;
  try {
    const exchangeRes = await fetch(`${backendBase}/v1/me/auth/slack/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ code, redirectUri }),
    });
    const exchangeJSON = (await exchangeRes.json().catch(() => null)) as
      | { slackUserAccessToken?: string }
      | null;
    if (!exchangeRes.ok || !exchangeJSON?.slackUserAccessToken) {
      return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
    }
    slackUserAccessToken = exchangeJSON.slackUserAccessToken;
  } catch {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  try {
    const response = await fetch(`${backendBase}/v1/me/auth/slack/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ slackUserAccessToken }),
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

    const redirectResponse = NextResponse.redirect(new URL(`${origin}/me?me_welcome=1`, origin));
    const expires = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
    redirectResponse.cookies.set(meSessionCookieName, payload.sessionToken, {
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

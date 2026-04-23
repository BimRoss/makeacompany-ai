import { NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin-session-cookie";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { cookieSecureFromRequest, resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const token = reqURL.searchParams.get("token")?.trim() ?? "";
  const loginBase = `${origin}/admin/login`;

  if (!token) {
    return NextResponse.redirect(new URL(`${loginBase}?auth=failed`, origin));
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/magic/finish?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(backendURL, { cache: "no-store" });
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

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  encodeFirstTouch,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_SECONDS,
  type FirstTouchPayload,
} from "@/lib/first-touch";
import { portalChannelCookieName, portalSessionCookieName } from "@/lib/portal-session-cookies";
import { matchCompanyPortalPath } from "@/lib/slack-channel-id";

const adminSessionCookieName = "mac_admin_session";

/** Removed from portal URLs; Stripe checkout prefill is no longer used for Google/email sign-in. */
const legacyPortalStripeSearchKeys = ["stripe_customer", "stripeCustomer", "stripeCustomerId"] as const;

function stripLegacyPortalStripeSearchParams(url: URL): boolean {
  let removed = false;
  for (const key of legacyPortalStripeSearchKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      removed = true;
    }
  }
  return removed;
}

/**
 * Set the first-touch attribution cookie on the response if this is the
 * visitor's first arrival (no existing cookie) and the request is a real GET
 * page navigation. Idempotent — once the cookie exists it's never overwritten.
 * See `src/lib/first-touch.ts` for the payload shape.
 */
function maybeSetFirstTouch(request: NextRequest, response: NextResponse): void {
  if (request.method !== "GET") return;
  if (request.cookies.get(FIRST_TOUCH_COOKIE)) return;

  const url = request.nextUrl;
  const params = url.searchParams;
  const payload: FirstTouchPayload = {
    p: url.pathname || "/",
    ts: Date.now(),
  };
  const utmSource = params.get("utm_source");
  if (utmSource) payload.s = utmSource;
  const utmMedium = params.get("utm_medium");
  if (utmMedium) payload.m = utmMedium;
  const utmCampaign = params.get("utm_campaign");
  if (utmCampaign) payload.c = utmCampaign;
  const utmContent = params.get("utm_content");
  if (utmContent) payload.co = utmContent;
  const utmTerm = params.get("utm_term");
  if (utmTerm) payload.t = utmTerm;
  const referer = request.headers.get("referer");
  if (referer) payload.r = referer;

  response.cookies.set({
    name: FIRST_TOUCH_COOKIE,
    value: encodeFirstTouch(payload),
    maxAge: FIRST_TOUCH_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    // Non-HttpOnly so gtag can read it when firing conversion events.
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // cost.makeacompany.ai → serve /cost (and /cost.pdf passthrough)
  const host = (request.headers.get("host") || "").toLowerCase();
  if (host.startsWith("cost.")) {
    if (pathname === "/" || pathname === "") {
      return NextResponse.rewrite(new URL("/cost", request.url));
    }
  }

  const session = request.cookies.get(adminSessionCookieName)?.value?.trim();
  const hasSession = Boolean(session);
  const portalSession = request.cookies.get(portalSessionCookieName)?.value?.trim();
  const portalCID = request.cookies.get(portalChannelCookieName)?.value?.trim();
  const hasPortalSession = Boolean(portalSession) && Boolean(portalCID);

  if (pathname === "/admin/login") {
    // Do not redirect to /admin based on cookie presence alone: invalid or stale cookies
    // caused a bounce loop with API 401 → /admin/login → middleware → /admin.
    return NextResponse.next();
  }

  if (pathname === "/twitter" || pathname.startsWith("/twitter/")) {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // /marketing reuses the admin session cookie (issue #303). Cookie-presence
  // gate only at this layer; the page itself re-verifies the session against
  // the backend and enforces the marketing-specific email allowlist.
  if (pathname === "/marketing" || pathname.startsWith("/marketing/")) {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  const portalPath = matchCompanyPortalPath(pathname);
  if (portalPath) {
    const sessionMatchesURL = hasPortalSession && portalCID === portalPath.channelId;
    if (portalPath.isLogin) {
      // Same as admin: cookie + channel match does not prove the session is still valid in Redis.
      const loginClean = new URL(request.url);
      if (stripLegacyPortalStripeSearchParams(loginClean)) {
        return NextResponse.redirect(loginClean);
      }
      return NextResponse.next();
    }
    if (!sessionMatchesURL) {
      const login = new URL(`/${portalPath.channelId}/login`, request.url);
      login.search = request.nextUrl.search;
      stripLegacyPortalStripeSearchParams(login);
      return NextResponse.redirect(login);
    }
    const portalResponse = NextResponse.next();
    maybeSetFirstTouch(request, portalResponse);
    return portalResponse;
  }

  const response = NextResponse.next();
  maybeSetFirstTouch(request, response);
  return response;
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/marketing",
    "/marketing/:path*",
    "/twitter",
    "/twitter/:path*",
    "/((?!api|_next|favicon.ico|admin|marketing|twitter|privacy|terms|opengraph-image|twitter-image|robots.txt|sitemap.xml|manifest).*)",
  ],
};

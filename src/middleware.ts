import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  encodeFirstTouch,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_SECONDS,
  type FirstTouchPayload,
} from "@/lib/first-touch";

const adminSessionCookieName = "mac_admin_session";

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

  // incubator.makeacompany.ai → serve the preview incubator lander at "/".
  // noindex header keeps the preview out of search; the /incubator page also
  // sets robots noindex in its metadata as a second layer.
  if (host.startsWith("incubator.")) {
    if (pathname === "/" || pathname === "") {
      const res = NextResponse.rewrite(new URL("/incubator", request.url));
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
      return res;
    }
  }

  // preview.makeacompany.ai → serve the minimal design-preview lander at "/".
  // noindex header keeps it out of search; the /preview page also sets robots
  // noindex in its metadata as a second layer.
  if (host.startsWith("preview.")) {
    if (pathname === "/" || pathname === "") {
      const res = NextResponse.rewrite(new URL("/preview", request.url));
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
      return res;
    }
  }

  const session = request.cookies.get(adminSessionCookieName)?.value?.trim();
  const hasSession = Boolean(session);

  if (pathname === "/admin/login") {
    // Do not redirect to /admin based on cookie presence alone: invalid or stale cookies
    // caused a bounce loop with API 401 → /admin/login → middleware → /admin.
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
    "/((?!api|_next|favicon.ico|admin|marketing|privacy|terms|opengraph-image|twitter-image|robots.txt|sitemap.xml|manifest).*)",
  ],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get(adminSessionCookieName)?.value?.trim();
  const hasSession = Boolean(session);
  const portalSession = request.cookies.get(portalSessionCookieName)?.value?.trim();
  const portalCID = request.cookies.get(portalChannelCookieName)?.value?.trim();
  const hasPortalSession = Boolean(portalSession) && Boolean(portalCID);

  if (pathname === "/admin/login") {
    if (hasSession) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  const portalPath = matchCompanyPortalPath(pathname);
  if (portalPath) {
    const sessionMatchesURL = hasPortalSession && portalCID === portalPath.channelId;
    if (portalPath.isLogin) {
      if (sessionMatchesURL) {
        return NextResponse.redirect(new URL(`/${portalPath.channelId}`, request.url));
      }
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
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/((?!api|_next|favicon.ico|admin|skills|employees|twitter|agents|orchestrator|slack-orchestrator|privacy|terms|opengraph-image|twitter-image|robots.txt|sitemap.xml|manifest).*)",
  ],
};

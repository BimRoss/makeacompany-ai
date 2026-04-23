import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { portalChannelCookieName, portalSessionCookieName } from "@/lib/portal-session-cookies";
import { matchCompanyPortalPath } from "@/lib/slack-channel-id";

const adminSessionCookieName = "mac_admin_session";

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
      return NextResponse.next();
    }
    if (!sessionMatchesURL) {
      return NextResponse.redirect(new URL(`/${portalPath.channelId}/login`, request.url));
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

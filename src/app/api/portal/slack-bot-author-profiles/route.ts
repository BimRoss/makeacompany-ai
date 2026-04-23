import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSlackBotAuthorProfilesFromEnv } from "@/lib/admin/slack-bot-author-env";
import { portalSessionCookieName } from "@/lib/portal-session-cookies";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/**
 * Same payload as `/api/admin/slack-bot-author-profiles`, for signed-in portal users viewing `/[channelId]`.
 * Bot user IDs and portrait URLs are not secrets; still requires a portal session cookie.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(portalSessionCookieName)?.value?.trim();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const profiles = getSlackBotAuthorProfilesFromEnv();
  return NextResponse.json({ profiles }, { status: 200, headers: noStore });
}

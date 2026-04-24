import { NextResponse } from "next/server";

import { getSlackAuthorProfiles } from "@/lib/admin/slack-author-profiles";
import { requirePortalApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/**
 * Same payload as `/api/admin/slack-bot-author-profiles` (including optional per-row `email` from Slack `users.list`), for signed-in portal users viewing `/[channelId]`.
 * Requires a valid portal session (verified with backend).
 */
export async function GET() {
  const unauthorized = await requirePortalApiSession();
  if (unauthorized) {
    return unauthorized;
  }
  const profiles = await getSlackAuthorProfiles({ slackToken: process.env.SLACK_BOT_TOKEN });
  return NextResponse.json({ profiles }, { status: 200, headers: noStore });
}

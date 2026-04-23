import { NextResponse } from "next/server";

import { getSlackBotAuthorProfilesFromEnv } from "@/lib/admin/slack-bot-author-env";
import { resolveBackendBearerToken } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/**
 * Slack bot user ID → display name + portrait URL for admin channel transcripts.
 * Reads `MULTIAGENT_BOT_USER_IDS` and/or `ROSS_SLACK_BOT_ID`, `TIM_SLACK_BOT_ID`, … (same as employee-factory).
 */
export async function GET() {
  const token = await resolveBackendBearerToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const profiles = getSlackBotAuthorProfilesFromEnv();
  return NextResponse.json({ profiles }, { status: 200, headers: noStore });
}

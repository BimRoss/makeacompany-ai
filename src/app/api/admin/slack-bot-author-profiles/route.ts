import { NextResponse } from "next/server";

import { getSlackAuthorProfiles } from "@/lib/admin/slack-author-profiles";
import { requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/**
 * Slack user ID → display name + portrait URL for channel transcripts (Slack `users.list`, same workspace data as the Slack Users admin table).
 * Env bot IDs fill gaps when `users.list` omits a row (name only; no local headshot assets).
 */
export async function GET() {
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return unauthorized;
  }
  const profiles = await getSlackAuthorProfiles({ slackToken: process.env.SLACK_BOT_TOKEN });
  return NextResponse.json({ profiles }, { status: 200, headers: noStore });
}

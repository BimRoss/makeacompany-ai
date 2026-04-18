import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ChannelMembersPayload = {
  schema_version?: number;
  channel_id?: string;
  human_user_ids?: string[];
  truncated_members?: boolean;
  truncated_human_ids?: boolean;
};

/**
 * Proxies to slack-orchestrator GET /debug/channel-members?channel_id=C...
 * (human Slack user IDs in the channel, excluding bots).
 */
export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channel_id")?.trim();
  if (!channelId) {
    return NextResponse.json({ error: "missing channel_id" }, { status: 400 });
  }

  const base = process.env.ORCHESTRATOR_DEBUG_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Set ORCHESTRATOR_DEBUG_BASE_URL (same as Orchestrator log). Example: http://127.0.0.1:8080 with slack-orchestrator running.",
      },
      { status: 503 },
    );
  }

  const serverToken = process.env.ORCHESTRATOR_DEBUG_TOKEN?.trim();
  const target = new URL("/debug/channel-members", base);
  target.searchParams.set("channel_id", channelId);
  const headers: HeadersInit = {};
  if (serverToken) {
    headers.Authorization = `Bearer ${serverToken}`;
  }

  const res = await fetch(target.toString(), {
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      return NextResponse.json(
        {
          error: parsed.error ?? "upstream",
          message: parsed.message ?? text.slice(0, 2000),
          status: res.status,
        },
        { status: res.status === 401 || res.status === 403 ? res.status : 502 },
      );
    } catch {
      return NextResponse.json(
        { error: "upstream", status: res.status, body: text.slice(0, 2000) },
        { status: res.status === 401 || res.status === 403 ? res.status : 502 },
      );
    }
  }

  try {
    const data = JSON.parse(text) as ChannelMembersPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "invalid_upstream_json", body: text.slice(0, 500) }, { status: 502 });
  }
}

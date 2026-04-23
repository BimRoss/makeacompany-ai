import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

type MemberChannelsPayload = {
  schema_version?: number;
  channels?: Array<{ channel_id: string; name?: string; is_private?: boolean }>;
  truncated?: boolean;
};

/**
 * Proxies to slack-orchestrator GET /debug/member-channels (Slack users.conversations for the orchestrator bot).
 * Same auth and base URL as /api/orchestrator-decisions.
 */
export async function GET() {
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return unauthorized;
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
  const target = new URL("/debug/member-channels", base);
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
    const data = JSON.parse(text) as MemberChannelsPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "invalid_upstream_json", body: text.slice(0, 500) }, { status: 502 });
  }
}

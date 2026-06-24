import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Per-agent: forward the agentId query param so the backend resolves THIS
  // agent's live Slack icon, not just agents[0] (#651).
  const agentId = new URL(request.url).searchParams.get("agentId")?.trim() ?? "";
  const base = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/icon-current`;
  const url = agentId ? `${base}?agentId=${encodeURIComponent(agentId)}` : base;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

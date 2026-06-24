import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

// GET /api/me/connections/google/status?agentId=… → { connected, email }
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Per-agent: forward agentId so status reflects THIS agent's Google link (#651).
  const agentId = new URL(request.url).searchParams.get("agentId")?.trim() ?? "";
  const base = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/google/status`;
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

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

// POST /api/me/connections/google/disconnect → { ok, revoked }
// Body: { agentId? } — per-agent target (#651).
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let agentId = "";
  try {
    const body = (await request.json()) as { agentId?: string };
    agentId = (body?.agentId ?? "").trim();
  } catch {
    // Body is optional — back-compat single-agent disconnect sends none.
  }
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/google/disconnect`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(agentId ? { agentId } : {}),
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

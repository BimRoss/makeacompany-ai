import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

// Proxies the "Share my agent" visibility toggle (#657) to the backend,
// forwarding the owner session cookie as a bearer. The {id} path param is
// carried through to /v1/me/personal-agents/{id}/visibility.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/${encodeURIComponent(id)}/visibility`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

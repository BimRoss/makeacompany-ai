import { NextResponse } from "next/server";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let channelId = "";
  let email = "";
  try {
    const body = (await request.json()) as { channelId?: string; email?: string };
    channelId = (body.channelId ?? "").trim();
    email = (body.email ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!channelId || !email) {
    return NextResponse.json({ error: "missing channelId or email" }, { status: 400 });
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/magic/start`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ channelId, email }),
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

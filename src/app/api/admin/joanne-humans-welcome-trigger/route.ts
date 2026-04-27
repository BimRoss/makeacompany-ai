import { NextResponse } from "next/server";

import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/joanne-humans-welcome-trigger`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await backendProxyAuthHeaders()),
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `joanne welcome trigger proxy failed: ${message}` }, { status: 502 });
  }
}

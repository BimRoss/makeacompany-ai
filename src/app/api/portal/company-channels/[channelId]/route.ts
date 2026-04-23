import { NextResponse } from "next/server";

import {
  adminProxyNextJson,
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const id = encodeURIComponent((channelId ?? "").trim());
  if (!id) {
    return NextResponse.json({ error: "missing channel id" }, { status: 400 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/company-channels/${id}`;
  try {
    const response = await fetch(backendURL, {
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `portal company-channel proxy failed: ${message}` }, 502);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const id = encodeURIComponent((channelId ?? "").trim());
  if (!id) {
    return NextResponse.json({ error: "missing channel id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/company-channels/${id}`;
  try {
    const response = await fetch(backendURL, {
      method: "PATCH",
      headers: {
        ...(await portalProxyAuthHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `portal company-channel proxy failed: ${message}` }, 502);
  }
}

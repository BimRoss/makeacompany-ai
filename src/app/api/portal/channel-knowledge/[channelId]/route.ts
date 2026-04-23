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
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/channel-knowledge/${id}`;
  try {
    const response = await fetch(backendURL, {
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `portal channel-knowledge proxy failed: ${message}` }, 502);
  }
}

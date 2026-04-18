import { NextResponse } from "next/server";
import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

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
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `channel-knowledge proxy failed: ${message}` }, { status: 502 });
  }
}

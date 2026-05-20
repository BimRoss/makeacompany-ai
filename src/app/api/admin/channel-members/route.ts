import { NextRequest } from "next/server";
import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const channelID = request.nextUrl.searchParams.get("channel_id") ?? "";
  const qs = new URLSearchParams({ channel_id: channelID }).toString();
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/channel-members?${qs}`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `channel-members proxy failed: ${message}` }, 502);
  }
}

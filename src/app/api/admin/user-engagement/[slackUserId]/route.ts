import { NextRequest } from "next/server";
import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slackUserId: string }> },
) {
  const { slackUserId } = await context.params;
  const id = (slackUserId ?? "").trim();
  if (!id) {
    return adminProxyNextJson({ error: "slackUserId required" }, 400);
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/user-engagement/${encodeURIComponent(id)}`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `user-engagement proxy failed: ${message}` }, 502);
  }
}

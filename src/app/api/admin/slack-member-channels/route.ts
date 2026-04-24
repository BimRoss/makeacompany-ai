import { NextRequest } from "next/server";
import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

/**
 * Proxies to Go GET /v1/admin/slack-member-channels (Redis snapshot by default; ?source=live hits orchestrator and rewrites Redis).
 * Previously proxied slack-orchestrator directly on every /admin load.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const suffix = qs ? `?${qs}` : "";
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/slack-member-channels${suffix}`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `slack-member-channels proxy failed: ${message}` }, 502);
  }
}

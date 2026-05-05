import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  requirePortalApiSession,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

/**
 * Same payload as `/api/admin/slack-bot-author-profiles`, served from the backend (Slack token on API only).
 */
export async function GET() {
  const unauthorized = await requirePortalApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/slack-bot-author-profiles`;
  try {
    const response = await fetch(backendURL, {
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return portalProxyNextJson({ error: `portal slack-bot-author-profiles proxy failed: ${message}` }, 502);
  }
}

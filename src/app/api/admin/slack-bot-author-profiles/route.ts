import {
  adminProxyNextJson,
  backendProxyAuthHeaders,
  parseBackendProxyBody,
  requireAdminApiSession,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

/**
 * Proxies `/v1/admin/slack-bot-author-profiles`: Slack users.list (+ env bot IDs) runs on makeacompany-backend
 * where `ORCHESTRATOR_SLACK_BOT_TOKEN` (legacy `SLACK_BOT_TOKEN`) is configured — not `process.env` on Next.js
 * (docker compose frontend often omits it).
 */
export async function GET() {
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/slack-bot-author-profiles`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `slack-bot-author-profiles proxy failed: ${message}` }, 502);
  }
}

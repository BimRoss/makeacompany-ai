import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/billing/cancel-subscription`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return portalProxyNextJson({ error: `portal cancel-subscription proxy failed: ${message}` }, 502);
  }
}

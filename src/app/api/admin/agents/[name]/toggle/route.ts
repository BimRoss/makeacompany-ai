import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const safeName = encodeURIComponent(name);
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/agents/${safeName}/toggle`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `agent toggle proxy failed: ${message}` }, 502);
  }
}

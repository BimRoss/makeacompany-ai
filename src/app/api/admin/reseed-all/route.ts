import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/reseed-all`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { ...(await backendProxyAuthHeaders()), "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `reseed-all proxy failed: ${message}` }, 502);
  }
}

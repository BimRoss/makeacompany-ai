import {
  adminProxyNextJson,
  backendProxyAuthHeaders,
  parseBackendProxyBody,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminProxyNextJson({ error: "invalid json" }, 400);
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/user-profile/free-lifetime`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await backendProxyAuthHeaders()) },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `free-lifetime proxy failed: ${message}` }, 502);
  }
}

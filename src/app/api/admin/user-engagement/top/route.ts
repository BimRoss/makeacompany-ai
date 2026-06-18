import { NextRequest } from "next/server";
import { adminProxyNextJson, backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const suffix = qs ? `?${qs}` : "";
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/user-engagement/top${suffix}`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `user-engagement/top proxy failed: ${message}` }, 502);
  }
}

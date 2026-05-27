import { NextResponse } from "next/server";
import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/ga4-summary`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `ga4-summary proxy failed: ${message}` }, { status: 502 });
  }
}

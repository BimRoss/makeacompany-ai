import { NextRequest, NextResponse } from "next/server";
import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const suffix = qs ? `?${qs}` : "";
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/stripe-waitlist-purchasers${suffix}`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `stripe-waitlist-purchasers proxy failed: ${message}` }, { status: 502 });
  }
}

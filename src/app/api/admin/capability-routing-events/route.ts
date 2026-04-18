import { NextResponse } from "next/server";
import { resolveBackendBaseURL, resolveBackendBearerToken } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = await resolveBackendBearerToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channelId") ?? "";
  const limit = url.searchParams.get("limit") ?? "50";
  const qs = new URLSearchParams();
  if (channelId) qs.set("channelId", channelId);
  qs.set("limit", limit);
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/capability-routing-events?${qs.toString()}`;
  try {
    const response = await fetch(backendURL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `capability-routing proxy failed: ${message}` }, { status: 502 });
  }
}

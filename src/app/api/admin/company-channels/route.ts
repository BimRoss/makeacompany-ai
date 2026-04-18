import { NextResponse } from "next/server";
import { resolveBackendBaseURL, resolveBackendBearerToken } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await resolveBackendBearerToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/company-channels`;
  try {
    const response = await fetch(backendURL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `company-channels proxy failed: ${message}` }, { status: 502 });
  }
}

import { NextResponse } from "next/server";

import {
  backendProxyAuthHeaders,
  parseBackendProxyBody,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

// Admin aggregate proxy: lists every personal agent across owners
// (issue #183 / #186 PR5). Admin-session-cookie gated; the upstream
// handler does the actual allowlist check.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/personal-agents`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `admin personal-agents proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

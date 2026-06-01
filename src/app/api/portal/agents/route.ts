import { NextResponse } from "next/server";

import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

// Personal-agent portal proxy: list + create (issue #183 / #186 PR5).
// Reads the portal session cookie, attaches a bearer to the upstream
// /v1/portal/agents call. Mirrors src/app/api/portal/billing/cancel-
// subscription/route.ts in shape — see that file for the full pattern
// rationale.
export const dynamic = "force-dynamic";

const backendPath = "/v1/portal/agents";

export async function GET() {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}${backendPath}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `personal-agents list proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}${backendPath}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(await portalProxyAuthHeaders()),
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `personal-agents create proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

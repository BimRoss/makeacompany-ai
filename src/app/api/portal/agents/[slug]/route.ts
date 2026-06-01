import { NextResponse } from "next/server";

import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

// Per-agent portal proxy: GET / DELETE for /me/agents/<slug> (issue
// #183 / #186 PR5). Token-paste is its own subroute (./slack-token).
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function backendURL(slug: string): string {
  return `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/agents/${encodeURIComponent(slug)}`;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const response = await fetch(backendURL(slug), {
      method: "GET",
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `personal-agent get proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const response = await fetch(backendURL(slug), {
      method: "DELETE",
      headers: await portalProxyAuthHeaders(),
      cache: "no-store",
    });
    // 204 has no body — return empty JSON with the original status.
    if (response.status === 204) {
      return portalProxyNextJson({}, 204);
    }
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `personal-agent delete proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

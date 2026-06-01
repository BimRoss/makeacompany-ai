import { NextResponse } from "next/server";

import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

// Token-paste proxy: forwards { bot_token, app_token, bot_user_id } to
// the backend's POST /v1/portal/agents/<slug>/slack-token, which
// validates + writes the per-agent k8s Secret (issue #183 / #186 PR5
// fronting PR3's writer).
//
// Token bodies stay in transit only — neither the proxy nor any
// Next.js intermediary persists them. The backend writes directly to
// the personal-agents namespace Secret and discards the request body.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await request.text();
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/agents/${encodeURIComponent(slug)}/slack-token`;
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
    if (response.status === 204) {
      return portalProxyNextJson({}, 204);
    }
    const payload = await parseBackendProxyBody(response);
    return portalProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `slack-token proxy failed: ${message}` },
      { status: 502 },
    );
  }
}

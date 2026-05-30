import { NextRequest, NextResponse } from "next/server";

import {
  parseBackendProxyBody,
  portalProxyAuthHeaders,
  portalProxyNextJson,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

// /api/portal/workspace/disconnect — receives a form POST from the
// WorkspaceConnectPanel's Disconnect button. Reads the channelId from
// form data, forwards a JSON POST to the backend disconnect/finish
// endpoint with the portal session bearer, then redirects the browser
// back to /<channelId> with a workspace_disconnected=1 flag so the
// panel renders the success banner on next load.
//
// JSON callers (curl/tests) also work: missing form data falls through
// to JSON body decode, and the response is JSON instead of a redirect.
//
// Driver: BimRoss/google-workspace-mcp#15 Section A3.

export async function POST(req: NextRequest) {
  let channelId = "";
  let preferRedirect = true;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      channelId = (form.get("channelId") ?? "").toString().trim();
    } catch {
      // fall through — channelId stays empty, handled below
    }
  } else {
    preferRedirect = false;
    try {
      const body = (await req.json()) as { channelId?: string };
      channelId = (body.channelId ?? "").trim();
    } catch {
      // fall through
    }
  }

  if (!channelId) {
    if (preferRedirect) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return portalProxyNextJson({ error: "channelId required" }, 400);
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/workspace/disconnect/finish`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        ...(await portalProxyAuthHeaders()),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ channelId }),
    });

    if (!preferRedirect) {
      const payload = await parseBackendProxyBody(response);
      return portalProxyNextJson(payload, response.status);
    }

    if (response.ok) {
      return NextResponse.redirect(
        new URL(`/${encodeURIComponent(channelId)}?workspace_disconnected=1`, req.url),
        { status: 303 },
      );
    }
    // Backend declined — surface a short reason in the URL so the
    // channel page can render something useful instead of silently
    // doing nothing.
    const reason = response.status === 401 ? "unauthorized" : "failed";
    return NextResponse.redirect(
      new URL(`/${encodeURIComponent(channelId)}?workspace_disconnect_error=${reason}`, req.url),
      { status: 303 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!preferRedirect) {
      return portalProxyNextJson({ error: `portal workspace disconnect proxy failed: ${message}` }, 502);
    }
    return NextResponse.redirect(
      new URL(`/${encodeURIComponent(channelId)}?workspace_disconnect_error=unreachable`, req.url),
      { status: 303 },
    );
  }
}

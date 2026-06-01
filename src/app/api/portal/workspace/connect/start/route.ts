import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";

import {
  createWorkspaceConnectState,
  portalWorkspacePendingCookieName,
} from "@/lib/portal-workspace-connect-state";
import { cookieSecureFromRequest, resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

// Connect Workspace — initiates the OAuth 2.1 dance against the gws-mcp
// gateway. Sibling to /api/portal/auth/google/start (Sign in with Google),
// but the gateway acts as the OAuth Authorization Server: it issues a
// per-tenant DCR client_id, proxies Google consent, and is what the
// per-pod sidecar's refresh_token is bound to. See
// ~/Dev/oauth21-proof/spike-refresh/dance_capture.py for the proven flow
// and [[gws-mcp-per-pod-token-mint]] for why each tenant must have its
// own DCR client_id (identity = client_id, server-side).
//
// Scopes mirror the dance_capture.py set proven against the dev gateway.
// gmail.modify (sensitive, no CASA) covers read/write/label/draft/send/
// trash; permanent-delete needs mail.google.com/ (restricted) — call out
// for product decision before submitting verification. drive (restricted)
// is unavoidable for full Drive access; drive.file would dodge CASA but
// blocks Ross from reading existing customer content.

const DEFAULT_GATEWAY = "https://google-mcp-oauth.makeacompany.ai";

const WORKSPACE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/tasks",
] as const;

type DiscoveryMetadata = {
  registration_endpoint?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
};

type DcrResponse = {
  client_id?: string;
  client_secret?: string;
};

function gatewayBaseURL(): string {
  return (process.env.WORKSPACE_MCP_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(
    /\/$/,
    "",
  );
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function fail(origin: string, channelId: string, reason: string) {
  const ch = encodeURIComponent(channelId.trim());
  const target = ch
    ? `${origin}/${ch}?workspace_connect=failed&reason=${encodeURIComponent(reason)}`
    : `${origin}/?workspace_connect=failed&reason=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(new URL(target, origin));
}

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const channelId = reqURL.searchParams.get("channelId")?.trim() ?? "";
  if (!channelId) {
    return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  }
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const gateway = gatewayBaseURL();
  const redirectUri = `${origin}/api/portal/workspace/connect/callback`;

  let metadata: DiscoveryMetadata;
  try {
    const res = await fetch(`${gateway}/.well-known/oauth-authorization-server`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return fail(origin, channelId, "discovery_failed");
    }
    metadata = (await res.json()) as DiscoveryMetadata;
  } catch {
    return fail(origin, channelId, "discovery_failed");
  }
  if (
    !metadata.registration_endpoint ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint
  ) {
    return fail(origin, channelId, "discovery_incomplete");
  }

  let dcr: DcrResponse;
  try {
    const res = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        client_name: `makeacompany-portal:${channelId}`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    if (!res.ok && res.status !== 201) {
      return fail(origin, channelId, "dcr_failed");
    }
    dcr = (await res.json()) as DcrResponse;
  } catch {
    return fail(origin, channelId, "dcr_failed");
  }
  if (!dcr.client_id || !dcr.client_secret) {
    return fail(origin, channelId, "dcr_incomplete");
  }

  const { verifier, challenge } = generatePkce();
  const created = createWorkspaceConnectState(
    channelId,
    { clientId: dcr.client_id, clientSecret: dcr.client_secret },
    verifier,
  );
  if (!created) {
    return fail(origin, channelId, "state_secret_missing");
  }

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: dcr.client_id,
    redirect_uri: redirectUri,
    scope: WORKSPACE_SCOPES.join(" "),
    state: created.urlState,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authURL = `${metadata.authorization_endpoint}?${authParams.toString()}`;

  const response = NextResponse.redirect(authURL);
  response.cookies.set(portalWorkspacePendingCookieName, created.pendingCookie, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/api/portal/workspace/connect",
    maxAge: Math.floor(created.ttlMs / 1000),
  });
  return response;
}

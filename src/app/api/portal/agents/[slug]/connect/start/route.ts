import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";

import {
  createPersonalAgentConnectState,
  portalPersonalAgentPendingCookieName,
  portalPersonalAgentPendingCookiePath,
} from "@/lib/portal-personal-agent-connect-state";
import { cookieSecureFromRequest, resolvePublicOrigin } from "@/lib/http-origin";

// Personal-agent Connect Google — initiates the OAuth 2.1 dance
// against the gws-mcp gateway (#183 / #186 PR6). Sibling to
// /api/portal/workspace/connect/start; same discovery + DCR + PKCE
// flow, but keyed on agent slug instead of channelId so the resulting
// refresh_token is bound to (owner_user_id, agent_slug) rather than
// a channel tenant.

export const dynamic = "force-dynamic";

const DEFAULT_GATEWAY = "https://google-mcp-oauth.makeacompany.ai";

// Same scopes as the workspace flow — agents need the same access
// surface. If a personal agent ever wants narrower scopes (read-only
// gmail, no drive), it lands as a per-agent override in a later PR.
const PERSONAL_AGENT_SCOPES = [
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

type Ctx = { params: Promise<{ slug: string }> };

type DiscoveryMetadata = {
  registration_endpoint?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
};

type DcrResponse = { client_id?: string; client_secret?: string };

function gatewayBaseURL(): string {
  return (process.env.WORKSPACE_MCP_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(/\/$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function fail(origin: string, slug: string, reason: string) {
  const target = slug
    ? `${origin}/me/agents?personal_agent_connect=failed&slug=${encodeURIComponent(slug)}&reason=${encodeURIComponent(reason)}`
    : `${origin}/me/agents?personal_agent_connect=failed&reason=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(new URL(target, origin));
}

export async function GET(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const trimmedSlug = slug.trim();
  if (!trimmedSlug) {
    return NextResponse.json({ error: "missing slug" }, { status: 400 });
  }
  const origin = resolvePublicOrigin(request);
  const secureCookies = cookieSecureFromRequest(request);
  const gateway = gatewayBaseURL();
  const redirectUri = `${origin}/api/portal/agents/${encodeURIComponent(trimmedSlug)}/connect/callback`;

  let metadata: DiscoveryMetadata;
  try {
    const res = await fetch(`${gateway}/.well-known/oauth-authorization-server`, {
      cache: "no-store",
    });
    if (!res.ok) return fail(origin, trimmedSlug, "discovery_failed");
    metadata = (await res.json()) as DiscoveryMetadata;
  } catch {
    return fail(origin, trimmedSlug, "discovery_failed");
  }
  if (!metadata.registration_endpoint || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    return fail(origin, trimmedSlug, "discovery_incomplete");
  }

  let dcr: DcrResponse;
  try {
    const res = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        client_name: `makeacompany-personal:${trimmedSlug}`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    if (!res.ok && res.status !== 201) return fail(origin, trimmedSlug, "dcr_failed");
    dcr = (await res.json()) as DcrResponse;
  } catch {
    return fail(origin, trimmedSlug, "dcr_failed");
  }
  if (!dcr.client_id || !dcr.client_secret) {
    return fail(origin, trimmedSlug, "dcr_incomplete");
  }

  const { verifier, challenge } = generatePkce();
  const created = createPersonalAgentConnectState(
    trimmedSlug,
    { clientId: dcr.client_id, clientSecret: dcr.client_secret },
    verifier,
  );
  if (!created) {
    return fail(origin, trimmedSlug, "state_secret_missing");
  }

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: dcr.client_id,
    redirect_uri: redirectUri,
    scope: PERSONAL_AGENT_SCOPES.join(" "),
    state: created.urlState,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authURL = `${metadata.authorization_endpoint}?${authParams.toString()}`;

  const response = NextResponse.redirect(authURL);
  response.cookies.set(portalPersonalAgentPendingCookieName, created.pendingCookie, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: portalPersonalAgentPendingCookiePath,
    maxAge: Math.floor(created.ttlMs / 1000),
  });
  return response;
}

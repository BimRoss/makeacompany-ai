import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  parsePersonalAgentPendingCookie,
  parsePersonalAgentUrlState,
  portalPersonalAgentPendingCookieName,
  portalPersonalAgentPendingCookiePath,
} from "@/lib/portal-personal-agent-connect-state";
import { portalSessionCookieName } from "@/lib/portal-session-cookies";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { resolvePublicOrigin } from "@/lib/http-origin";

// Callback for the personal-agent Connect Google flow (#183 / #186
// PR6). Sibling to /api/portal/workspace/connect/callback. Verifies
// the URL state matches the pending cookie's nonce, exchanges the
// auth code at the gateway's /token endpoint, and hands the resulting
// credential bundle to the backend so it can update the AgentTenant
// record + write Google credentials into the per-agent k8s Secret.

export const dynamic = "force-dynamic";

const DEFAULT_GATEWAY = "https://google-mcp-oauth.makeacompany.ai";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type Ctx = { params: Promise<{ slug: string }> };

function gatewayBaseURL(): string {
  return (process.env.WORKSPACE_MCP_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(/\/$/, "");
}

function clearPendingCookie(response: NextResponse) {
  response.cookies.set(portalPersonalAgentPendingCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    path: portalPersonalAgentPendingCookiePath,
    maxAge: 0,
  });
  return response;
}

function fail(origin: string, slug: string, reason: string) {
  const target = slug
    ? `${origin}/me/agents?personal_agent_connect=failed&slug=${encodeURIComponent(slug)}&reason=${encodeURIComponent(reason)}`
    : `${origin}/me/agents?personal_agent_connect=failed&reason=${encodeURIComponent(reason)}`;
  return clearPendingCookie(NextResponse.redirect(new URL(target, origin)));
}

// decodeJWTPayload pulls the email + sub claims out of an OIDC
// id_token without verifying the signature — we trust the token
// because we just got it from a successful TLS handshake with the
// gateway over a code we minted in the same flow. The backend will
// verify the (email, sub) pair against the refresh_token's lifecycle
// independently.
function decodeJWTPayload(idToken: string): { email?: string; sub?: string } {
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as { email?: string; sub?: string };
    return {
      email: typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : undefined,
      sub: typeof parsed.sub === "string" ? parsed.sub.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export async function GET(request: Request, ctx: Ctx) {
  const { slug: pathSlug } = await ctx.params;
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const code = reqURL.searchParams.get("code")?.trim();
  const state = reqURL.searchParams.get("state")?.trim() ?? "";
  const oauthErr = reqURL.searchParams.get("error")?.trim();

  const cookieHeader = request.headers.get("cookie") ?? "";
  const pendingRaw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${portalPersonalAgentPendingCookieName}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const pending = pendingRaw ? parsePersonalAgentPendingCookie(pendingRaw) : null;
  const parsedState = parsePersonalAgentUrlState(state);

  const slug = parsedState?.slug ?? pending?.slug ?? pathSlug.trim();

  if (oauthErr) return fail(origin, slug, `provider_${oauthErr}`);
  if (!pending || !parsedState) return fail(origin, slug, "state_invalid");
  if (pending.nonce !== parsedState.nonce) return fail(origin, slug, "nonce_mismatch");
  if (pending.slug !== parsedState.slug) return fail(origin, slug, "slug_mismatch");
  if (pending.slug !== pathSlug.trim()) return fail(origin, slug, "slug_path_mismatch");
  if (!code) return fail(origin, slug, "missing_code");

  const gateway = gatewayBaseURL();
  const redirectUri = `${origin}/api/portal/agents/${encodeURIComponent(pending.slug)}/connect/callback`;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: pending.clientId,
    client_secret: pending.clientSecret,
    code_verifier: pending.verifier,
  });

  let tok: TokenResponse;
  try {
    const tokRes = await fetch(`${gateway}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
      body: tokenBody.toString(),
    });
    if (!tokRes.ok) return fail(origin, slug, "token_exchange_failed");
    tok = (await tokRes.json()) as TokenResponse;
  } catch {
    return fail(origin, slug, "token_exchange_failed");
  }
  if (!tok.access_token || !tok.refresh_token) {
    return fail(origin, slug, "token_response_incomplete");
  }

  const { email: googleEmail, sub: googleSubject } = tok.id_token
    ? decodeJWTPayload(tok.id_token)
    : {};

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(portalSessionCookieName)?.value ?? "";
  if (!sessionToken) return fail(origin, slug, "missing_portal_session");

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/agents/${encodeURIComponent(pending.slug)}/connect/finish`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        dcr: {
          clientId: pending.clientId,
          clientSecret: pending.clientSecret,
        },
        refreshToken: tok.refresh_token,
        scope: tok.scope ?? "",
        googleEmail: googleEmail ?? "",
        googleSubject: googleSubject ?? "",
      }),
    });
    if (response.status === 401 || response.status === 403) {
      return fail(origin, slug, "unauthorized");
    }
    if (!response.ok && response.status !== 204) {
      return fail(origin, slug, "backend_finish_failed");
    }
  } catch {
    return fail(origin, slug, "backend_unreachable");
  }

  return clearPendingCookie(
    NextResponse.redirect(new URL(`${origin}/me/agents?personal_agent_connected=1`, origin)),
  );
}

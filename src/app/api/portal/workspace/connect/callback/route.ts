import { NextResponse } from "next/server";

import {
  parseWorkspacePendingCookie,
  parseWorkspaceUrlState,
  portalWorkspacePendingCookieName,
} from "@/lib/portal-workspace-connect-state";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

// Callback for the Connect Workspace flow. Verifies the URL state matches
// the pending cookie's nonce, exchanges the auth code at the gateway's
// /token endpoint, and hands the resulting credential bundle to the
// backend so it can land in a per-tenant K8s Secret + trigger a Ross pod
// restart (#15). Token shape per
// ~/Dev/oauth21-proof/spike-refresh/dance_capture.py: HS256 JWT access
// (TTL ~1h) plus a rotating refresh_token; identity is bound server-side
// to the DCR client_id.

const DEFAULT_GATEWAY = "https://google-mcp-oauth.makeacompany.ai";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function gatewayBaseURL(): string {
  return (process.env.WORKSPACE_MCP_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(
    /\/$/,
    "",
  );
}

function clearPendingCookie(response: NextResponse) {
  response.cookies.set(portalWorkspacePendingCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/portal/workspace/connect",
    maxAge: 0,
  });
  return response;
}

function fail(origin: string, channelId: string, reason: string) {
  const ch = encodeURIComponent(channelId.trim());
  const target = ch
    ? `${origin}/${ch}?workspace_connect=failed&reason=${encodeURIComponent(reason)}`
    : `${origin}/?workspace_connect=failed&reason=${encodeURIComponent(reason)}`;
  return clearPendingCookie(NextResponse.redirect(new URL(target, origin)));
}

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const origin = resolvePublicOrigin(request);
  const code = reqURL.searchParams.get("code")?.trim();
  const state = reqURL.searchParams.get("state")?.trim() ?? "";
  const oauthErr = reqURL.searchParams.get("error")?.trim();

  const cookieHeader = request.headers.get("cookie") ?? "";
  const pendingRaw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${portalWorkspacePendingCookieName}=`))
    ?.split("=")
    .slice(1)
    .join("=");
  const pending = pendingRaw ? parseWorkspacePendingCookie(pendingRaw) : null;
  const parsedState = parseWorkspaceUrlState(state);

  const channelId =
    parsedState?.channelId ?? pending?.channelId ?? "";

  if (oauthErr) {
    return fail(origin, channelId, `provider_${oauthErr}`);
  }
  if (!pending || !parsedState) {
    return fail(origin, channelId, "state_invalid");
  }
  if (pending.nonce !== parsedState.nonce) {
    return fail(origin, channelId, "nonce_mismatch");
  }
  if (pending.channelId !== parsedState.channelId) {
    return fail(origin, channelId, "channel_mismatch");
  }
  if (!code) {
    return fail(origin, channelId, "missing_code");
  }

  const gateway = gatewayBaseURL();
  const redirectUri = `${origin}/api/portal/workspace/connect/callback`;
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
    if (!tokRes.ok) {
      return fail(origin, channelId, "token_exchange_failed");
    }
    tok = (await tokRes.json()) as TokenResponse;
  } catch {
    return fail(origin, channelId, "token_exchange_failed");
  }
  if (!tok.access_token || !tok.refresh_token) {
    return fail(origin, channelId, "token_response_incomplete");
  }

  // Hand the credential bundle to the backend. The backend is the only
  // component with kubeconfig + KMS access; it writes the per-tenant
  // Secret (gws-mcp-oauth-<channel-slug>) into the customer's Ross pod
  // namespace and triggers the pod restart so the sidecar boots with
  // the new identity. Backend endpoint to be implemented as part of #15.
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/workspace/connect/finish`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        channelId: pending.channelId,
        dcr: {
          clientId: pending.clientId,
          clientSecret: pending.clientSecret,
        },
        refreshToken: tok.refresh_token,
        scope: tok.scope ?? "",
      }),
    });
    if (response.status === 403) {
      return fail(origin, channelId, "unauthorized");
    }
    if (!response.ok) {
      return fail(origin, channelId, "backend_finish_failed");
    }
  } catch {
    return fail(origin, channelId, "backend_unreachable");
  }

  const ch = encodeURIComponent(channelId.trim());
  return clearPendingCookie(
    NextResponse.redirect(new URL(`${origin}/${ch}?workspace_connected=1`, origin)),
  );
}

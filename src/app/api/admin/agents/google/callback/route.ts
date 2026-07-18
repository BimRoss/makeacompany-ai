import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolvePublicOrigin } from "@/lib/http-origin";
import {
  backendProxyAuthHeaders,
  resolveBackendBaseURL,
  requireAdminApiSession,
} from "@/lib/backend-proxy-auth";
import { adminAgentGoogleTxnCookieName } from "@/lib/admin-agent-google";

export const dynamic = "force-dynamic";

interface ConnectTxn {
  state: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  redirectUri: string;
  agent: string;
}

// GET /api/admin/agents/google/callback?code=...&state=...
//
// Completes the admin consent dance: validates the stashed transaction,
// exchanges the auth code for a refresh token (PKCE), then hands the DCR client
// + refresh token to the backend connect/finish for the target agent, which
// re-writes the gws-mcp-oauth Secret + rolls the pod. Admin-gated: the txn
// cookie alone is not sufficient, we re-verify the admin session before the
// backend write.
export async function GET(request: Request) {
  const origin = resolvePublicOrigin(request);
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/admin?agent_google=error&reason=${reason}`);

  // Admin gate: re-verify the session cookie against the backend before we do
  // anything privileged (state cookie is CSRF defense, not authN).
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return NextResponse.redirect(`${origin}/admin/login`);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  // Surface the real upstream error code (e.g. invalid_scope, access_denied)
  // rather than a blanket label, so failures are debuggable from the toast.
  const upstreamErr = url.searchParams.get("error");
  if (upstreamErr) {
    console.error(
      "admin agent google callback error:",
      upstreamErr,
      url.searchParams.get("error_description") ?? "",
    );
    return fail(encodeURIComponent(upstreamErr));
  }
  if (!code || !state) return fail("missing_code");

  const cookieStore = await cookies();
  const rawTxn = cookieStore.get(adminAgentGoogleTxnCookieName)?.value ?? "";
  if (!rawTxn) return fail("expired");
  let txn: ConnectTxn;
  try {
    txn = JSON.parse(rawTxn) as ConnectTxn;
  } catch {
    return fail("bad_txn");
  }
  // CSRF: the state returned by the gateway must match the one we issued.
  if (!txn.state || txn.state !== state) return fail("state_mismatch");
  if (!txn.agent) return fail("no_agent");

  // [4] Token exchange (PKCE).
  let tok: { refresh_token?: string };
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: txn.redirectUri,
      client_id: txn.clientId,
      client_secret: txn.clientSecret,
      code_verifier: txn.verifier,
    });
    const res = await fetch(txn.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    tok = await res.json();
  } catch {
    return fail("token_exchange");
  }
  if (!tok.refresh_token) {
    // No refresh token → the sidecar can't mint bearers.
    return fail("no_refresh_token");
  }

  // Hand off to the backend, authenticated as the admin session.
  try {
    const backend = resolveBackendBaseURL().replace(/\/$/, "");
    const res = await fetch(
      `${backend}/v1/admin/agents/${encodeURIComponent(txn.agent)}/google/connect/finish`,
      {
        method: "POST",
        headers: {
          ...(await backendProxyAuthHeaders()),
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          clientId: txn.clientId,
          clientSecret: txn.clientSecret,
          refreshToken: tok.refresh_token,
        }),
      },
    );
    if (!res.ok) {
      return fail(res.status === 404 ? "no_agent" : "backend");
    }
  } catch {
    return fail("backend");
  }

  // Success — clear the one-time txn cookie and return to /admin.
  const response = NextResponse.redirect(
    `${origin}/admin?agent_google=ok&agent=${encodeURIComponent(txn.agent)}`,
  );
  response.cookies.set(adminAgentGoogleTxnCookieName, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/admin/agents/google",
    maxAge: 0,
  });
  return response;
}

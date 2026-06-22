import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolvePublicOrigin } from "@/lib/http-origin";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";
import { googleConnectTxnCookieName, googleConnectScopes } from "@/lib/personal-agent-google";

export const dynamic = "force-dynamic";

interface ConnectTxn {
  state: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  redirectUri: string;
}

// Best-effort email from an OIDC id_token (cosmetic — identity is bound
// server-side by the gateway in OAuth21 mode). Never throws.
function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : "";
  } catch {
    return "";
  }
}

// GET /api/me/connections/google/callback?code=...&state=...
//
// Completes the consent dance: validates the stashed transaction, exchanges
// the auth code for a refresh token (PKCE), then hands the DCR client +
// refresh token to the backend connect/finish, which writes the per-owner
// Secret + sidecar RBAC and rolls the pod.
export async function GET(request: Request) {
  const origin = resolvePublicOrigin(request);
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/me?google_connect=error&reason=${reason}`);

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.get("error")) return fail("consent_denied");
  if (!code || !state) return fail("missing_code");

  const cookieStore = await cookies();
  const session = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!session) return NextResponse.redirect(`${origin}/me/login`);

  const rawTxn = cookieStore.get(googleConnectTxnCookieName)?.value ?? "";
  if (!rawTxn) return fail("expired");
  let txn: ConnectTxn;
  try {
    txn = JSON.parse(rawTxn) as ConnectTxn;
  } catch {
    return fail("bad_txn");
  }
  // CSRF: the state returned by the gateway must match the one we issued.
  if (!txn.state || txn.state !== state) return fail("state_mismatch");

  // [4] Token exchange (PKCE).
  let tok: { refresh_token?: string; id_token?: string };
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
    // No refresh token → the sidecar can't mint bearers. Surfaces the
    // offline_access knob if a provider gated it.
    return fail("no_refresh_token");
  }

  // Hand off to the backend, authenticated as the /me session owner.
  try {
    const backend = resolveBackendBaseURL().replace(/\/$/, "");
    const res = await fetch(`${backend}/v1/me/personal-agents/google/connect/finish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        dcr: { clientId: txn.clientId, clientSecret: txn.clientSecret },
        refreshToken: tok.refresh_token,
        email: emailFromIdToken(tok.id_token),
        scope: googleConnectScopes().join(" "),
      }),
    });
    if (!res.ok) {
      return fail(res.status === 404 ? "no_agent" : "backend");
    }
  } catch {
    return fail("backend");
  }

  // Success — clear the one-time txn cookie and return to /me.
  const response = NextResponse.redirect(`${origin}/me?google_connect=ok`);
  response.cookies.set(googleConnectTxnCookieName, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/me/connections/google",
    maxAge: 0,
  });
  return response;
}

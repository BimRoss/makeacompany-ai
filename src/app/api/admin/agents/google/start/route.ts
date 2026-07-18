import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { resolvePublicOrigin } from "@/lib/http-origin";
import { requireAdminApiSession } from "@/lib/backend-proxy-auth";
import {
  adminAgentGoogleGatewayURL,
  adminAgentGoogleTxnCookieName,
  adminAgentGoogleScopes,
} from "@/lib/admin-agent-google";

export const dynamic = "force-dynamic";

// GET /api/admin/agents/google/start?agent=<name>
//
// Kicks off the ADMIN-gated Google Workspace consent dance against the oauth21
// gateway, so an admin can re-auth a system agent's (ross/joanne) Google token
// from /admin instead of running dance_capture.py. Mirrors the /me PA start
// route (discovery → DCR /register → redirect to /authorize with PKCE) but is
// gated on the admin session and targets the oauth21 gateway. The DCR client +
// PKCE verifier + target agent are stashed in a short-lived httpOnly cookie the
// callback consumes.
export async function GET(request: Request) {
  const origin = resolvePublicOrigin(request);
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/admin?agent_google=error&reason=${reason}`);

  // Admin gate: require a valid admin session cookie, verified against the
  // backend (same contract as /v1/admin/auth/me). 401 (as an error redirect)
  // when absent/stale.
  const unauthorized = await requireAdminApiSession();
  if (unauthorized) {
    return NextResponse.redirect(`${origin}/admin/login`);
  }

  const agent = new URL(request.url).searchParams.get("agent")?.trim() ?? "";
  if (!agent) return fail("missing_agent");

  const gateway = adminAgentGoogleGatewayURL();
  const redirectUri = `${origin}/api/admin/agents/google/callback`;

  // [1] Discovery
  let meta: {
    registration_endpoint?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
  };
  try {
    const res = await fetch(`${gateway}/.well-known/oauth-authorization-server`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`);
    meta = await res.json();
  } catch {
    return fail("discovery");
  }
  if (!meta.registration_endpoint || !meta.authorization_endpoint || !meta.token_endpoint) {
    return fail("discovery_fields");
  }

  // [2] Dynamic Client Registration — self-declares our callback as a
  // redirect_uri (only the gateway's own /oauth2callback lives in the GCP
  // client, so no GCP-console redirect-URI add is needed for ours).
  let reg: { client_id?: string; client_secret?: string };
  try {
    const res = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        client_name: "makeacompany-admin-agent",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    if (res.status !== 200 && res.status !== 201) throw new Error(`register HTTP ${res.status}`);
    reg = await res.json();
  } catch {
    return fail("register");
  }
  if (!reg.client_id || !reg.client_secret) {
    return fail("register_fields");
  }

  // [3] PKCE + state, then redirect to the gateway authorize endpoint.
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    scope: adminAgentGoogleScopes().join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(`${meta.authorization_endpoint}?${authParams.toString()}`);
  // Stash the one-time transaction. httpOnly + Secure + Lax so it survives the
  // top-level redirect back from the gateway but is never readable by JS.
  response.cookies.set(
    adminAgentGoogleTxnCookieName,
    JSON.stringify({
      state,
      verifier,
      clientId: reg.client_id,
      clientSecret: reg.client_secret,
      tokenEndpoint: meta.token_endpoint,
      redirectUri,
      agent,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/admin/agents/google",
      maxAge: 600,
    },
  );
  return response;
}

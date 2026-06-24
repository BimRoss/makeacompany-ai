import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { resolvePublicOrigin } from "@/lib/http-origin";
import { meSessionCookieName } from "@/lib/me-session-cookies";
import {
  personalAgentGoogleGatewayURL,
  googleConnectTxnCookieName,
  googleConnectScopes,
} from "@/lib/personal-agent-google";

export const dynamic = "force-dynamic";

// GET /api/me/connections/google/start
//
// Kicks off the personal-agent Google Workspace consent dance against the PA
// OAuth 2.1 gateway. Ports oauth21-proof/spike-refresh/dance_capture.py to a
// browser flow: discovery → DCR /register → redirect to /authorize (PKCE).
// The DCR client + PKCE verifier are stashed in a short-lived httpOnly cookie
// and consumed by the callback route. The owner consents THEIR OWN Google
// account; the resulting refresh token is bound to that identity.
export async function GET(request: Request) {
  // Require a /me session — the callback needs it to call the backend
  // connect/finish on the owner's behalf.
  const cookieStore = await cookies();
  const session = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!session) {
    return NextResponse.redirect(`${resolvePublicOrigin(request)}/me/login`);
  }

  // Per-agent target (#651): the panel passes ?agentId so the connect/finish
  // (run in the callback) lands on the right agent. Carried through the OAuth
  // round-trip via the httpOnly txn cookie below.
  const agentId = new URL(request.url).searchParams.get("agentId")?.trim() ?? "";

  const gateway = personalAgentGoogleGatewayURL();
  const origin = resolvePublicOrigin(request);
  const redirectUri = `${origin}/api/me/connections/google/callback`;

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
    return NextResponse.redirect(`${origin}/me?google_connect=error&reason=discovery`);
  }
  if (!meta.registration_endpoint || !meta.authorization_endpoint || !meta.token_endpoint) {
    return NextResponse.redirect(`${origin}/me?google_connect=error&reason=discovery_fields`);
  }

  // [2] Dynamic Client Registration — self-declares our callback as a
  // redirect_uri, so no GCP-console redirect-URI add is needed for it (only
  // the gateway's own /oauth2callback lives in the GCP client).
  let reg: { client_id?: string; client_secret?: string };
  try {
    const res = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        client_name: "makeacompany-personal-agent",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    if (res.status !== 200 && res.status !== 201) throw new Error(`register HTTP ${res.status}`);
    reg = await res.json();
  } catch {
    return NextResponse.redirect(`${origin}/me?google_connect=error&reason=register`);
  }
  if (!reg.client_id || !reg.client_secret) {
    return NextResponse.redirect(`${origin}/me?google_connect=error&reason=register_fields`);
  }

  // [3] PKCE + state, then redirect to the gateway authorize endpoint.
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    scope: googleConnectScopes().join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(`${meta.authorization_endpoint}?${authParams.toString()}`);
  // Stash the one-time transaction. httpOnly + Secure + Lax so it survives the
  // top-level redirect back from the gateway but is never readable by JS.
  response.cookies.set(
    googleConnectTxnCookieName,
    JSON.stringify({
      state,
      verifier,
      clientId: reg.client_id,
      clientSecret: reg.client_secret,
      tokenEndpoint: meta.token_endpoint,
      redirectUri,
      agentId,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/me/connections/google",
      maxAge: 600,
    },
  );
  return response;
}

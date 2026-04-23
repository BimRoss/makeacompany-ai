import { NextResponse } from "next/server";

import { createAdminGoogleOAuthState } from "@/lib/portal-google-oauth-state";
import { resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 503 });
  }
  const state = createAdminGoogleOAuthState();
  if (!state) {
    return NextResponse.json(
      {
        error:
          "oauth_state_secret_missing_set_PORTAL_GOOGLE_OAUTH_STATE_SECRET_or_GOOGLE_OAUTH_CLIENT_SECRET",
      },
      { status: 503 },
    );
  }
  const origin = resolvePublicOrigin(request);
  const redirectUri = `${origin}/api/admin/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(url);
}

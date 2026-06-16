import { NextResponse } from "next/server";

import { createMeSlackOAuthState } from "@/lib/slack-oauth-state";
import { resolvePublicOrigin } from "@/lib/http-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "slack_oauth_not_configured" }, { status: 503 });
  }
  const state = createMeSlackOAuthState();
  if (!state) {
    return NextResponse.json(
      { error: "oauth_state_secret_missing_set_PORTAL_GOOGLE_OAUTH_STATE_SECRET_or_SLACK_OAUTH_CLIENT_SECRET" },
      { status: 503 },
    );
  }
  const origin = resolvePublicOrigin(request);
  const redirectUri = `${origin}/api/me/auth/slack/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    user_scope: "identity.basic,identity.email",
    state,
  });
  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  return NextResponse.redirect(url);
}

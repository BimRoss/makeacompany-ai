// Shared config + constants for the personal-agent Google Workspace connect
// dance (start + callback route handlers). Server-side only.

// Public base URL of the personal-agent OAuth 2.1 gateway
// (rancher-admin admin/apps/google-workspace-mcp-gateway-pa). The browser
// consent dance hits its /authorize + /consent; the route handlers hit its
// /.well-known, /register, and /token. Overridable via env for non-prod.
export function personalAgentGoogleGatewayURL(): string {
  const v = process.env.PERSONAL_AGENT_GOOGLE_GATEWAY_URL?.trim();
  return v && v.length > 0 ? v.replace(/\/$/, "") : "https://google-mcp-pa.makeacompany.ai";
}

// Scopes requested at consent. First-pass set: Gmail read + Calendar, plus
// identity. NO offline_access — it is not a Google scope (Google uses the
// access_type=offline param) and the OAuth21 gateway rejects it with
// "Client was not registered with scope offline_access", bouncing /authorize
// straight back to the callback as invalid_scope. The gateway issues the
// refresh token to our DCR client itself, so we don't request offline_access.
// gmail.readonly is a RESTRICTED scope and drives the eventual CASA review;
// calendar is sensitive.
export function googleConnectScopes(): string[] {
  return [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar",
  ];
}

// One-time httpOnly cookie carrying the DCR client + PKCE verifier between the
// start and callback route handlers.
export const googleConnectTxnCookieName = "mac_pa_google_txn";

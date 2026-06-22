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

// Scopes requested at consent. Kept to the first-pass set (Gmail read +
// Calendar) plus identity + offline_access (the latter forces a refresh_token
// from providers that gate it behind the explicit scope — see
// dance_capture.py --scopes-offline). gmail.readonly is a RESTRICTED scope and
// drives the eventual CASA review; calendar is sensitive.
export function googleConnectScopes(): string[] {
  return [
    "offline_access",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar",
  ];
}

// One-time httpOnly cookie carrying the DCR client + PKCE verifier between the
// start and callback route handlers.
export const googleConnectTxnCookieName = "mac_pa_google_txn";

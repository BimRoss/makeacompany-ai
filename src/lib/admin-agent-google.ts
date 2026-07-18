// Shared config + constants for the ADMIN-gated system-agent (ross/joanne)
// Google Workspace connect dance (start + callback route handlers). Server-side
// only. Mirrors src/lib/personal-agent-google.ts but targets the oauth21
// gateway and is gated on an admin session (not a /me owner session).

// Public base URL of the system-agent OAuth 2.1 gateway
// (rancher-admin admin/apps/google-workspace-mcp-gateway-oauth21). The browser
// consent dance hits its /authorize + /consent; the route handlers hit its
// /.well-known, /register, and /token. Overridable via env for non-prod.
export function adminAgentGoogleGatewayURL(): string {
  const v = process.env.ADMIN_AGENT_GOOGLE_GATEWAY_URL?.trim();
  return v && v.length > 0 ? v.replace(/\/$/, "") : "https://google-mcp-oauth.makeacompany.ai";
}

// Scopes requested at consent — the full Workspace set the gws-mcp gateway
// supports. Copied verbatim from personal-agent-google.ts so a re-authed
// system agent keeps the same capabilities across Gmail, Calendar, Drive,
// Docs, Sheets, Slides, Tasks, Contacts, Forms, and Chat.
//
// NO offline_access — it is not a Google scope (Google uses the
// access_type=offline param) and the OAuth21 gateway rejects it as
// invalid_scope. The gateway issues the refresh token to our DCR client itself.
export function adminAgentGoogleScopes(): string[] {
  return [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/chat.messages",
  ];
}

// One-time httpOnly cookie carrying the target agent + DCR client + PKCE
// verifier between the start and callback route handlers.
export const adminAgentGoogleTxnCookieName = "mac_admin_google_txn";

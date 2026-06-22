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

// Scopes requested at consent — the full Workspace set the gws-mcp gateway
// supports, so a connected agent can act across Gmail, Calendar, Drive, Docs,
// Sheets, Slides, Tasks, Contacts, Forms, and Chat.
//
// Tiers (govern verification, not function under the 100-user cap):
//   - restricted (need CASA to scale past 100): gmail.modify, gmail.send, drive
//   - sensitive  (need verification, no CASA):  calendar, documents,
//     spreadsheets, presentations, tasks, contacts, forms.body, chat.messages
//   - non-sensitive: openid, userinfo.email/.profile
// Under 100 connected users all of these work today behind the "unverified
// app → proceed" screen; CASA/verification is the gate to scale past that.
//
// NO offline_access — it is not a Google scope (Google uses the
// access_type=offline param) and the OAuth21 gateway rejects it as
// invalid_scope. The gateway issues the refresh token to our DCR client itself.
export function googleConnectScopes(): string[] {
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

// One-time httpOnly cookie carrying the DCR client + PKCE verifier between the
// start and callback route handlers.
export const googleConnectTxnCookieName = "mac_pa_google_txn";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// State helpers for the "Connect Workspace" flow.
//
// Distinct from portal-google-oauth-state.ts (Sign-in with Google) because
// this flow goes through the gws-mcp gateway's OAuth 2.1 surface, not
// straight to Google:
//   1. Discovery (.well-known/oauth-authorization-server)
//   2. DCR — gateway issues per-tenant client_id + client_secret
//   3. PKCE code_verifier + challenge
//   4. Browser redirected to gateway /authorize (which proxies Google consent)
//   5. Callback exchanges code + verifier + DCR client_secret at /token
//
// The PKCE verifier + DCR client_secret have to survive the cross-domain
// bounce. URL state alone won't fit them; we split:
//   - URL `state`  — HMAC-signed JSON: { kind, channelId, nonce, exp }
//   - Cookie      — HMAC-signed JSON: { nonce, clientId, clientSecret,
//                                       verifier, channelId, exp }
// The nonce ties them together so a stolen URL alone can't replay.

const PENDING_COOKIE_NAME = "mac_workspace_oauth_pending";
const TTL_MS = 15 * 60 * 1000;
const STATE_KIND = "workspace";

export const portalWorkspacePendingCookieName = PENDING_COOKIE_NAME;

function stateSecret(): string | null {
  const s =
    process.env.PORTAL_GOOGLE_OAUTH_STATE_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  return s.length >= 16 ? s : null;
}

function sign(payload: string): string | null {
  const secret = stateSecret();
  if (!secret) {
    return null;
  }
  const sig = createHmac("sha256", secret).update(payload).digest();
  const pB = Buffer.from(payload, "utf8").toString("base64url");
  const sB = sig.toString("base64url");
  return `v1.${pB}.${sB}`;
}

function verify(token: string): string | null {
  const secret = stateSecret();
  if (!secret) {
    return null;
  }
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return null;
  }
  const [, pB, sB] = parts;
  let payload: string;
  let gotSig: Buffer;
  try {
    payload = Buffer.from(pB, "base64url").toString("utf8");
    gotSig = Buffer.from(sB, "base64url");
  } catch {
    return null;
  }
  const wantSig = createHmac("sha256", secret).update(payload).digest();
  if (gotSig.length !== wantSig.length || !timingSafeEqual(gotSig, wantSig)) {
    return null;
  }
  return payload;
}

export type WorkspacePendingState = {
  nonce: string;
  clientId: string;
  clientSecret: string;
  verifier: string;
  channelId: string;
};

export type WorkspaceUrlState = {
  channelId: string;
  nonce: string;
};

export type CreatedWorkspaceState = {
  urlState: string;
  pendingCookie: string;
  ttlMs: number;
};

export function createWorkspaceConnectState(
  channelId: string,
  dcr: { clientId: string; clientSecret: string },
  verifier: string,
): CreatedWorkspaceState | null {
  const cid = channelId.trim();
  const clientId = dcr.clientId.trim();
  const clientSecret = dcr.clientSecret.trim();
  const v = verifier.trim();
  if (!cid || !clientId || !clientSecret || !v) {
    return null;
  }
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + TTL_MS;

  const urlState = sign(JSON.stringify({ kind: STATE_KIND, cid, nonce, exp }));
  const pendingCookie = sign(
    JSON.stringify({ nonce, clientId, clientSecret, verifier: v, cid, exp }),
  );
  if (!urlState || !pendingCookie) {
    return null;
  }
  return { urlState, pendingCookie, ttlMs: TTL_MS };
}

export function parseWorkspaceUrlState(state: string): WorkspaceUrlState | null {
  const payload = verify(state);
  if (!payload) {
    return null;
  }
  let parsed: { kind?: string; cid?: string; nonce?: string; exp?: number };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.kind !== STATE_KIND) {
    return null;
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) {
    return null;
  }
  const channelId = typeof parsed.cid === "string" ? parsed.cid.trim() : "";
  const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
  if (!channelId || !nonce) {
    return null;
  }
  return { channelId, nonce };
}

export function parseWorkspacePendingCookie(
  cookieValue: string,
): WorkspacePendingState | null {
  const payload = verify(cookieValue);
  if (!payload) {
    return null;
  }
  let parsed: {
    nonce?: string;
    clientId?: string;
    clientSecret?: string;
    verifier?: string;
    cid?: string;
    exp?: number;
  };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return null;
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) {
    return null;
  }
  const out: WorkspacePendingState = {
    nonce: parsed.nonce?.trim() ?? "",
    clientId: parsed.clientId?.trim() ?? "",
    clientSecret: parsed.clientSecret?.trim() ?? "",
    verifier: parsed.verifier?.trim() ?? "",
    channelId: parsed.cid?.trim() ?? "",
  };
  if (
    !out.nonce ||
    !out.clientId ||
    !out.clientSecret ||
    !out.verifier ||
    !out.channelId
  ) {
    return null;
  }
  return out;
}

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// State helpers for the personal-agent Connect Google flow (issue
// #183 / #186 PR6). Sibling to portal-workspace-connect-state.ts —
// same shape, same gws-mcp-oauth gateway dance, but keyed on
// `(owner_user_id, agent_slug)` instead of channelId.
//
// Distinct STATE_KIND so a state cookie from one flow can't be
// replayed against the other; distinct pending-cookie name + scope
// path so the two pending cookies coexist in the same browser
// without one stomping the other.

const PENDING_COOKIE_NAME = "mac_personal_agent_oauth_pending";
const TTL_MS = 15 * 60 * 1000;
const STATE_KIND = "personal-agent";

export const portalPersonalAgentPendingCookieName = PENDING_COOKIE_NAME;
export const portalPersonalAgentPendingCookiePath = "/api/portal/agents";

function stateSecret(): string | null {
  // Reuse the same secret as the workspace-connect flow — both flows
  // talk to the same gateway and operators rotate one secret for both.
  const s =
    process.env.PORTAL_GOOGLE_OAUTH_STATE_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  return s.length >= 16 ? s : null;
}

function sign(payload: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;
  const sig = createHmac("sha256", secret).update(payload).digest();
  const pB = Buffer.from(payload, "utf8").toString("base64url");
  const sB = sig.toString("base64url");
  return `v1.${pB}.${sB}`;
}

function verify(token: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
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

export type PersonalAgentPendingState = {
  nonce: string;
  clientId: string;
  clientSecret: string;
  verifier: string;
  slug: string;
};

export type PersonalAgentUrlState = {
  slug: string;
  nonce: string;
};

export type CreatedPersonalAgentState = {
  urlState: string;
  pendingCookie: string;
  ttlMs: number;
};

export function createPersonalAgentConnectState(
  slug: string,
  dcr: { clientId: string; clientSecret: string },
  verifier: string,
): CreatedPersonalAgentState | null {
  const s = slug.trim();
  const clientId = dcr.clientId.trim();
  const clientSecret = dcr.clientSecret.trim();
  const v = verifier.trim();
  if (!s || !clientId || !clientSecret || !v) return null;
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + TTL_MS;
  const urlState = sign(JSON.stringify({ kind: STATE_KIND, slug: s, nonce, exp }));
  const pendingCookie = sign(
    JSON.stringify({ nonce, clientId, clientSecret, verifier: v, slug: s, exp }),
  );
  if (!urlState || !pendingCookie) return null;
  return { urlState, pendingCookie, ttlMs: TTL_MS };
}

export function parsePersonalAgentUrlState(state: string): PersonalAgentUrlState | null {
  const payload = verify(state);
  if (!payload) return null;
  let parsed: { kind?: string; slug?: string; nonce?: string; exp?: number };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.kind !== STATE_KIND) return null;
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) return null;
  const slug = typeof parsed.slug === "string" ? parsed.slug.trim() : "";
  const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
  if (!slug || !nonce) return null;
  return { slug, nonce };
}

export function parsePersonalAgentPendingCookie(
  cookieValue: string,
): PersonalAgentPendingState | null {
  const payload = verify(cookieValue);
  if (!payload) return null;
  let parsed: {
    nonce?: string;
    clientId?: string;
    clientSecret?: string;
    verifier?: string;
    slug?: string;
    exp?: number;
  };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return null;
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) return null;
  const out: PersonalAgentPendingState = {
    nonce: parsed.nonce?.trim() ?? "",
    clientId: parsed.clientId?.trim() ?? "",
    clientSecret: parsed.clientSecret?.trim() ?? "",
    verifier: parsed.verifier?.trim() ?? "",
    slug: parsed.slug?.trim() ?? "",
  };
  if (
    !out.nonce ||
    !out.clientId ||
    !out.clientSecret ||
    !out.verifier ||
    !out.slug
  ) {
    return null;
  }
  return out;
}

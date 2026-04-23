import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function stateSecret(): string | null {
  const s =
    process.env.PORTAL_GOOGLE_OAUTH_STATE_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  return s.length >= 16 ? s : null;
}

export type ParsedGoogleOAuthState = { kind: "portal"; channelId: string } | { kind: "admin" };

function signPayload(payload: string): string | null {
  const secret = stateSecret();
  if (!secret) {
    return null;
  }
  const sig = createHmac("sha256", secret).update(payload).digest();
  const pB = Buffer.from(payload, "utf8").toString("base64url");
  const sB = sig.toString("base64url");
  return `v1.${pB}.${sB}`;
}

/** Build signed OAuth state carrying Slack channel id (15 min TTL). */
export function createPortalGoogleOAuthState(channelId: string): string | null {
  const cid = channelId.trim();
  if (!cid) {
    return null;
  }
  const exp = Date.now() + 15 * 60 * 1000;
  const n = randomBytes(16).toString("hex");
  const payload = JSON.stringify({ kind: "portal", cid, exp, n });
  return signPayload(payload);
}

/** Build signed OAuth state for admin dashboard sign-in (15 min TTL). */
export function createAdminGoogleOAuthState(): string | null {
  const exp = Date.now() + 15 * 60 * 1000;
  const n = randomBytes(16).toString("hex");
  const payload = JSON.stringify({ kind: "admin", exp, n });
  return signPayload(payload);
}

export function parseGoogleOAuthState(state: string): ParsedGoogleOAuthState | null {
  const secret = stateSecret();
  if (!secret) {
    return null;
  }
  const parts = state.trim().split(".");
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
  let parsed: { kind?: string; cid?: string; exp?: number; n?: string };
  try {
    parsed = JSON.parse(payload) as { kind?: string; cid?: string; exp?: number; n?: string };
  } catch {
    return null;
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) {
    return null;
  }
  if (parsed.kind === "admin") {
    return { kind: "admin" };
  }
  const cid = typeof parsed.cid === "string" ? parsed.cid.trim() : "";
  if (cid && (parsed.kind === "portal" || parsed.kind === undefined)) {
    return { kind: "portal", channelId: cid };
  }
  return null;
}

/** @deprecated use parseGoogleOAuthState — kept for call sites that only need portal channel id */
export function parsePortalGoogleOAuthState(state: string): { channelId: string } | null {
  const p = parseGoogleOAuthState(state);
  if (p?.kind === "portal") {
    return { channelId: p.channelId };
  }
  return null;
}

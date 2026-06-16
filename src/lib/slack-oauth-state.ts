import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function stateSecret(): string | null {
  const s =
    process.env.PORTAL_GOOGLE_OAUTH_STATE_SECRET?.trim() ||
    process.env.SLACK_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    "";
  return s.length >= 16 ? s : null;
}

export type ParsedSlackOAuthState = { kind: "me" };

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

/** Build signed OAuth state for /me Sign-in-with-Slack (15 min TTL). */
export function createMeSlackOAuthState(): string | null {
  const exp = Date.now() + 15 * 60 * 1000;
  const n = randomBytes(16).toString("hex");
  const payload = JSON.stringify({ kind: "me-slack", exp, n });
  return signPayload(payload);
}

export function parseSlackOAuthState(state: string): ParsedSlackOAuthState | null {
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
  let parsed: { kind?: string; exp?: number; n?: string };
  try {
    parsed = JSON.parse(payload) as { kind?: string; exp?: number; n?: string };
  } catch {
    return null;
  }
  const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
  if (exp <= 0 || Date.now() > exp) {
    return null;
  }
  if (parsed.kind === "me-slack") {
    return { kind: "me" };
  }
  return null;
}

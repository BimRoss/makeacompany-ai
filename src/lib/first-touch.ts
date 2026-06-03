/**
 * First-touch attribution cookie. Captures the utm_*, referrer, and landing path
 * the very first time a visitor hits the site, then survives 90 days so we can
 * attribute downstream conversions back to the original acquisition source.
 *
 * The cookie is *first-party*, *non-HttpOnly* (so gtag can read it client-side
 * when firing conversion events), and SameSite=Lax. Set by middleware on the
 * first non-cookied page navigation; never overwritten once present.
 *
 * Payload is URL-encoded JSON. Short keys to keep the cookie small.
 */

export const FIRST_TOUCH_COOKIE = "mac_first_touch";
export const FIRST_TOUCH_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export type FirstTouchPayload = {
  /** utm_source */
  s?: string;
  /** utm_medium */
  m?: string;
  /** utm_campaign */
  c?: string;
  /** utm_content */
  co?: string;
  /** utm_term */
  t?: string;
  /** Referer header on first visit */
  r?: string;
  /** Landing path */
  p: string;
  /** Capture timestamp (epoch ms) */
  ts: number;
};

export function encodeFirstTouch(payload: FirstTouchPayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

export function decodeFirstTouch(raw: string | undefined): FirstTouchPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.p !== "string" || typeof parsed.ts !== "number") return null;
    return parsed as FirstTouchPayload;
  } catch {
    return null;
  }
}

/**
 * Client-side reader for the first-touch cookie. Returns null on the server or
 * when the cookie is missing/malformed.
 */
export function readFirstTouchClient(): FirstTouchPayload | null {
  if (typeof document === "undefined") return null;
  const prefix = `${FIRST_TOUCH_COOKIE}=`;
  const match = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  if (!match) return null;
  return decodeFirstTouch(match.slice(prefix.length));
}

/**
 * Flatten a first-touch payload into gtag-friendly event params with stable,
 * documented names. Use when firing a conversion event so the original
 * acquisition source rides along.
 */
export function firstTouchToGtagParams(
  payload: FirstTouchPayload | null,
): Record<string, string | number> {
  if (!payload) return {};
  const out: Record<string, string | number> = {
    first_touch_path: payload.p,
    first_touch_ts: payload.ts,
  };
  if (payload.s) out.first_touch_source = payload.s;
  if (payload.m) out.first_touch_medium = payload.m;
  if (payload.c) out.first_touch_campaign = payload.c;
  if (payload.co) out.first_touch_content = payload.co;
  if (payload.t) out.first_touch_term = payload.t;
  if (payload.r) out.first_touch_referrer = payload.r;
  return out;
}

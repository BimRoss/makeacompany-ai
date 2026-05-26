import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export type LanderSlackSeats = { claimed: number | null; cap: number };

const DEFAULT_CAP = 100;

/**
 * Server-side fetch for the "N of CAP free seats claimed" pill. Hits the public,
 * unauthenticated backend endpoint `/v1/lander/slack-seats`. Any failure returns
 * `claimed: null` so the pill falls back to its hard-coded constant — the lander
 * must never break on a backend hiccup.
 */
export async function fetchLanderSlackSeats(): Promise<LanderSlackSeats> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/lander/slack-seats`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { claimed: null, cap: DEFAULT_CAP };
    const body = (await res.json()) as { claimed?: number | null; cap?: number };
    const cap = typeof body.cap === "number" && body.cap > 0 ? body.cap : DEFAULT_CAP;
    const claimed = typeof body.claimed === "number" && body.claimed >= 0 ? body.claimed : null;
    return { claimed, cap };
  } catch {
    return { claimed: null, cap: DEFAULT_CAP };
  }
}

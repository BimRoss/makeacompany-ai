import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export type LanderMessagesSentPoint = { day: string; messages: number };

export type LanderMessagesSent = {
  total: number | null;
  daily: LanderMessagesSentPoint[];
};

/**
 * Server-side fetch for the "Real messages sent" live tile on the lander.
 * Hits the public, unauthenticated `/v1/lander/messages-sent`. Any failure
 * returns `total: null` and an empty series so the section can render its
 * skeleton — the lander must never break on a backend hiccup.
 */
export async function fetchLanderMessagesSent(): Promise<LanderMessagesSent> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/lander/messages-sent`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { total: null, daily: [] };
    const body = (await res.json()) as { total?: number; daily?: LanderMessagesSentPoint[] };
    const total = typeof body.total === "number" && body.total >= 0 ? body.total : null;
    const daily = Array.isArray(body.daily)
      ? body.daily.filter(
          (p): p is LanderMessagesSentPoint =>
            !!p && typeof p.day === "string" && typeof p.messages === "number",
        )
      : [];
    return { total, daily };
  } catch {
    return { total: null, daily: [] };
  }
}

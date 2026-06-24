import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export type LanderPersonalAgent = { name: string; imageUrl?: string };

export type LanderPersonalAgents = {
  total: number;
  agents: LanderPersonalAgent[];
};

/**
 * Coerce an untrusted backend body into a clean LanderPersonalAgents. Shared by
 * the server-side fetch and the client poll so both apply the same guards.
 */
export function normalizeLanderPersonalAgents(body: {
  total?: number;
  agents?: Array<{ name?: unknown; imageUrl?: unknown }>;
}): LanderPersonalAgents {
  const agents = Array.isArray(body.agents)
    ? body.agents
        .filter((a): a is { name: string; imageUrl?: unknown } => !!a && typeof a.name === "string")
        .map((a) => ({
          name: a.name,
          imageUrl: typeof a.imageUrl === "string" && a.imageUrl ? a.imageUrl : undefined,
        }))
    : [];
  const total = typeof body.total === "number" && body.total >= 0 ? body.total : agents.length;
  return { total, agents };
}

/**
 * Server-side fetch for the "Agents our members have built" row on the lander.
 * Hits the public, unauthenticated `/v1/lander/personal-agents`. Any failure
 * returns an empty list so the section can quietly skip itself — the lander
 * must never break on a backend hiccup.
 */
export async function fetchLanderPersonalAgents(): Promise<LanderPersonalAgents> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/lander/personal-agents`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { total: 0, agents: [] };
    return normalizeLanderPersonalAgents(await res.json());
  } catch {
    return { total: 0, agents: [] };
  }
}

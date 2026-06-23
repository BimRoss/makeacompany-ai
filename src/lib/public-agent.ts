import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

/** Mirrors the backend PublicAgentProfile allowlist DTO (#657). */
export type PublicAgentKnowledge = {
  title?: string;
  bullets?: string[];
};

export type PublicAgentProfile = {
  id: string;
  displayName: string;
  description: string;
  longDescription?: string;
  avatarUrl?: string;
  builtBy?: string;
  createdAt?: string;
  intelligence?: PublicAgentKnowledge[];
  inviteUrl: string;
};

/**
 * Server-side fetch of one agent's public showcase profile. Returns null on a
 * 404 (private / nonexistent / not installed) or any error, so callers can map
 * straight to notFound(). no-store keeps a freshly-shared agent visible without
 * a stale cache window.
 */
export async function fetchPublicAgent(id: string): Promise<PublicAgentProfile | null> {
  const clean = id.trim();
  if (!clean) return null;
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/personal-agents/${encodeURIComponent(clean)}/public`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as PublicAgentProfile | null;
    if (!payload || !payload.id) return null;
    return payload;
  } catch {
    return null;
  }
}

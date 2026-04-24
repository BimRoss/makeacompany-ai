import { cache } from "react";

import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

/**
 * Resolved once per request (shared by generateMetadata + page) via React cache.
 * Loads a human-readable label from the Go backend (Redis company_channels), same rules as
 * companyPortalDisplayName; falls back to the Slack channel id when the registry row is missing
 * or the backend is unreachable.
 */
export const getPortalLoginCompanyLabel = cache(async (rawChannelId: string): Promise<{ label: string; channelId: string }> => {
  const channelId = decodeURIComponent((rawChannelId ?? "").trim());
  if (!channelId) {
    return { label: "", channelId: "" };
  }
  const idEnc = encodeURIComponent(channelId);
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/channel-public-label/${idEnc}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { label: channelId, channelId };
    }
    const body = (await res.json().catch(() => null)) as { label?: string; channel_id?: string } | null;
    const label = String(body?.label ?? "").trim();
    if (label) {
      return { label, channelId };
    }
  } catch {
    // timeout / connection — keep channel id as label
  }
  return { label: channelId, channelId };
});

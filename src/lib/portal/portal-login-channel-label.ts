import { cache } from "react";

import type { CompanyChannel } from "@/lib/admin/company-channels";
import { companyPortalDisplayName } from "@/lib/admin/company-channels";
import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

/**
 * Resolved once per request (shared by generateMetadata + page) via React cache.
 * Uses the same admin company-channel registry the portal uses, with server-side internal auth.
 */
export const getPortalLoginCompanyLabel = cache(async (rawChannelId: string): Promise<{ label: string; channelId: string }> => {
  const channelId = decodeURIComponent((rawChannelId ?? "").trim());
  if (!channelId) {
    return { label: "", channelId: "" };
  }
  const enc = encodeURIComponent(channelId);
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/admin/company-channels/${enc}`, {
      headers: { ...(await backendProxyAuthHeaders()) },
      cache: "no-store",
    });
    const payload = (await parseBackendProxyBody(res)) as { channel?: CompanyChannel } | null;
    if (res.ok && payload?.channel) {
      const label = companyPortalDisplayName(payload.channel).trim();
      if (label) return { label, channelId };
    }
  } catch {
    // fall through
  }
  return { label: channelId, channelId };
});

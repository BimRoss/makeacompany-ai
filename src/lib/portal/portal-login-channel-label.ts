import { cache } from "react";

/** Resolved once per request (shared by generateMetadata + page) via React cache. */
export const getPortalLoginCompanyLabel = cache(async (rawChannelId: string): Promise<{ label: string; channelId: string }> => {
  const channelId = decodeURIComponent((rawChannelId ?? "").trim());
  if (!channelId) {
    return { label: "", channelId: "" };
  }
  return { label: channelId, channelId };
});

/** Mirrors backend ValidSlackChannelID for company registry Slack channel ids (C… / G…). */
export function validSlackChannelId(id: string): boolean {
  const t = id.trim();
  if (t.length < 8 || t.length > 24) {
    return false;
  }
  if (t[0] !== "C" && t[0] !== "G") {
    return false;
  }
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if ((c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) {
      continue;
    }
    return false;
  }
  return true;
}

/** Parses `/{channelId}` or `/{channelId}/login` when channelId looks like a Slack company channel id. */
export function matchCompanyPortalPath(pathname: string): { channelId: string; isLogin: boolean } | null {
  const m = pathname.match(/^\/([CG][A-Z0-9]{7,23})(\/login)?\/?$/);
  if (!m?.[1]) {
    return null;
  }
  const channelId = m[1];
  if (!validSlackChannelId(channelId)) {
    return null;
  }
  return { channelId, isLogin: Boolean(m[2]) };
}

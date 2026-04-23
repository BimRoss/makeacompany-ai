/**
 * Client-only: when admin or portal API routes return 401/403 (stale cookie, revoked session),
 * full-page navigate to the matching login so middleware + sign-in run again.
 */

export function isUnauthorizedApiStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * @returns true if a redirect was started (caller should stop updating UI).
 */
export function kickToLoginForUnauthorizedApi(
  status: number,
  flow: "admin" | "portal",
  portalChannelId?: string,
): boolean {
  if (typeof window === "undefined" || !isUnauthorizedApiStatus(status)) {
    return false;
  }
  if (flow === "admin") {
    window.location.assign("/admin/login");
    return true;
  }
  const cid = (portalChannelId ?? "").trim();
  window.location.assign(cid ? `/${encodeURIComponent(cid)}/login` : "/");
  return true;
}

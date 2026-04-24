/** Query flag appended after portal sign-in; strip from the URL after the welcome toast is handled. */
export const PORTAL_WELCOME_SEARCH_PARAM = "portal_welcome";

export function peekPortalWelcomeParam(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get(PORTAL_WELCOME_SEARCH_PARAM)?.trim() === "1";
}

/** Removes `portal_welcome` via `history.replaceState` (call after showing the toast). */
export function stripPortalWelcomeParam(): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PORTAL_WELCOME_SEARCH_PARAM)) {
    return;
  }
  params.delete(PORTAL_WELCOME_SEARCH_PARAM);
  const q = params.toString();
  const nextURL = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextURL);
}

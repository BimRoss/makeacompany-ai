/** Query flag after admin Google sign-in; strip from the URL after the welcome toast is handled. */
export const ADMIN_WELCOME_SEARCH_PARAM = "admin_welcome";

export function peekAdminWelcomeParam(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).get(ADMIN_WELCOME_SEARCH_PARAM)?.trim() === "1";
}

/** Removes `admin_welcome` via `history.replaceState` (call after showing the toast). */
export function stripAdminWelcomeParam(): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has(ADMIN_WELCOME_SEARCH_PARAM)) {
    return;
  }
  params.delete(ADMIN_WELCOME_SEARCH_PARAM);
  const q = params.toString();
  const nextURL = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextURL);
}

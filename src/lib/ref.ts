export const REF_STORAGE_KEY = "makeacompany:ref";
const REF_URL_PARAM = "ref";

/** Read ?ref= from the current URL and persist it to localStorage. No-op if not present or storage unavailable. */
export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const v = new URLSearchParams(window.location.search).get(REF_URL_PARAM);
    if (v && v.trim()) {
      window.localStorage.setItem(REF_STORAGE_KEY, v.trim());
    }
  } catch {
    // Private mode or sandboxed — ignore.
  }
}

/** Return the stored ref slug, or empty string if missing/unavailable. */
export function getStoredRef(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(REF_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Clear the stored ref after a successful checkout so shared-browser misattribution can't happen. */
export function clearStoredRef(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    // ignore
  }
}

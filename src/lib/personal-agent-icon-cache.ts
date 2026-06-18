/**
 * Pre-install icon cache for personal agents.
 *
 * The chosen/generated icon at create time is pushed to the Slack *app*
 * (apps.icon.set), but `icon-current` reads the *bot user* profile photo live
 * from Slack — which doesn't exist until the user finishes OAuth install. To
 * show the icon in the /me status panel before install, we stash it in
 * localStorage keyed by the agent id and hydrate from there. Both the creation
 * form (write on create) and the status panel (write on edit, read on mount)
 * go through these helpers so the key never drifts between them.
 */

export type CachedAgentIcon = { base64: string; mimeType: string };

export function personalAgentIconStorageKey(id: string): string {
  return `mac.pa.icon.${id}`;
}

/** Persist the staged icon for an agent id. null clears it. No-op server-side. */
export function writeCachedAgentIcon(id: string | null | undefined, value: CachedAgentIcon | null): void {
  const key = (id ?? "").trim();
  if (!key || typeof window === "undefined") return;
  try {
    if (value?.base64 && value.mimeType) {
      window.localStorage.setItem(personalAgentIconStorageKey(key), JSON.stringify(value));
    } else {
      window.localStorage.removeItem(personalAgentIconStorageKey(key));
    }
  } catch {
    /* quota / privacy mode — preview just won't survive reload */
  }
}

/** Read the staged icon for an agent id, or null if absent/corrupt. */
export function readCachedAgentIcon(id: string | null | undefined): CachedAgentIcon | null {
  const key = (id ?? "").trim();
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(personalAgentIconStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAgentIcon | null;
    if (parsed?.base64 && parsed.mimeType) return parsed;
  } catch {
    /* corrupt entry — ignore */
  }
  return null;
}

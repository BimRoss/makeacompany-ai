/** Dispatched after a successful signup so waitlist UIs refetch stats. */
export const WAITLIST_REFRESH_EVENT = "waitlist:refresh";

/** Fallback if the API response omits `cap` (older backends). */
export const DEFAULT_WAITLIST_CAP = 100;

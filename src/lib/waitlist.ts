/** Dispatched after a successful signup so waitlist UIs refetch stats. */
export const WAITLIST_REFRESH_EVENT = "waitlist:refresh";

/** Dispatched when the admin Stripe purchasers snapshot is reloaded (see `UserProfilesPanel`). */
export const ADMIN_STRIPE_WAITLIST_REFRESH_EVENT = "admin:stripe-waitlist-purchasers-updated";

/** Fallback if the API response omits `cap` (older backends). */
export const DEFAULT_WAITLIST_CAP = 100;

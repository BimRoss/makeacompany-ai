/** HttpOnly cookie for company portal (`/{channelId}`) Stripe setup sessions. */
export const portalSessionCookieName = "mac_portal_session";

/** HttpOnly cookie: Slack channel id for the active portal session (must match URL for middleware). */
export const portalChannelCookieName = "mac_portal_cid";

/** Short-lived HttpOnly cookie: channel id during Stripe portal login (success_url matches admin: session_id only). */
export const portalStripeSigninChannelCookieName = "mac_portal_stripe_cid";

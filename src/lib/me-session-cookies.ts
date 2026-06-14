/** HttpOnly cookie for user-scope (/me) portal session token. Distinct from
 *  mac_portal_session so the channel portal and /me surfaces don't collide. */
export const meSessionCookieName = "mac_me_session";

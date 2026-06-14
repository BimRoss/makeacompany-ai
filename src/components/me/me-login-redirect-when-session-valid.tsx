"use client";

import { useEffect } from "react";

/**
 * Middleware can't assume the cookie implies a live backend session.
 * Redirect to /me only after /api/me/auth/me succeeds.
 */
export function MeLoginRedirectWhenSessionValid() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/auth/me", { method: "GET", cache: "no-store" });
        if (cancelled || !res.ok) {
          return;
        }
        const body = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (body?.authenticated === true) {
          window.location.assign("/me");
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

/**
 * When a valid admin session cookie exists, `/api/admin/*` proxies succeed but middleware
 * cannot validate cookies alone. We used to redirect `/admin/login` → `/admin` in middleware
 * whenever any cookie was present, which trapped users with stale cookies in a redirect loop
 * with `kickToLoginForUnauthorizedApi`. Only promote to `/admin` after backend confirms the session.
 */
export function AdminLoginRedirectWhenSessionValid() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/auth/me", { method: "GET", cache: "no-store" });
        if (cancelled || !res.ok) {
          return;
        }
        const body = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (body?.authenticated === true) {
          window.location.assign("/admin");
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

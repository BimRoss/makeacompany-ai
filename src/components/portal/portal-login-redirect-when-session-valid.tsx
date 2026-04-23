"use client";

import { useEffect } from "react";

/**
 * Same rationale as admin: middleware must not assume cookies imply a live session.
 * Redirect to the channel workspace only after `/api/portal/auth/me` succeeds for this channel.
 */
export function PortalLoginRedirectWhenSessionValid({ channelId }: { channelId: string }) {
  const want = channelId.trim();
  useEffect(() => {
    if (!want) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/auth/me", { method: "GET", cache: "no-store" });
        if (cancelled || !res.ok) {
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          authenticated?: boolean;
          channelId?: string;
        } | null;
        const cid = (body?.channelId ?? "").trim();
        if (body?.authenticated === true && cid && cid === want) {
          window.location.assign(`/${encodeURIComponent(want)}`);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [want]);

  return null;
}

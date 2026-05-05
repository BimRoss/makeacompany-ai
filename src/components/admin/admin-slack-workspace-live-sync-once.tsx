"use client";

import { useEffect } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

const SESSION_KEY = "mac_admin_slack_workspace_live_sync_v1";

/**
 * Once per tab session: Slack users.list → makeacompany backend Redis snapshot + profile slack_user_id index
 * (replaces employee-factory compose `user-profile-slack-sync` on boot for stacks that use agent-factory only).
 *
 * Retries 401 a few times before kicking to login: right after OAuth redirect, the first client fetch can
 * occasionally race cookie/session visibility in production while the server RSC path already validated
 * — a single immediate 401 would otherwise full-page navigate to /admin/login and feel like a "snap back".
 */
export function AdminSlackWorkspaceLiveSyncOnce() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    void (async () => {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      const url = "/api/admin/slack-workspace-users?source=live";
      const maxAttempts = 5;
      const pauseMs = 300;

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (cancelled) return;
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, pauseMs));
          }
          if (cancelled) return;

          const res = await fetch(url, { cache: "no-store" });
          if (cancelled) return;

          if (res.ok) {
            sessionStorage.setItem(SESSION_KEY, "1");
            return;
          }

          if (res.status === 401 && attempt < maxAttempts - 1) {
            continue;
          }

          if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
            sessionStorage.removeItem(SESSION_KEY);
            return;
          }
          sessionStorage.removeItem(SESSION_KEY);
          return;
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

const SESSION_KEY = "mac_admin_slack_workspace_live_sync_v1";

/**
 * Once per tab session: Slack users.list → makeacompany backend Redis snapshot + profile slack_user_id index
 * (replaces employee-factory compose `user-profile-slack-sync` on boot for stacks that use agent-factory only).
 */
export function AdminSlackWorkspaceLiveSyncOnce() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    void (async () => {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      sessionStorage.setItem(SESSION_KEY, "1");
      try {
        const res = await fetch("/api/admin/slack-workspace-users?source=live", { cache: "no-store" });
        if (cancelled) return;
        if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
          sessionStorage.removeItem(SESSION_KEY);
          return;
        }
        if (!res.ok) {
          sessionStorage.removeItem(SESSION_KEY);
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

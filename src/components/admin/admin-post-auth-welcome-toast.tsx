"use client";

import { useCallback, useEffect, useState } from "react";

import { PortalPostAuthWelcomeToast } from "@/components/portal/portal-post-auth-welcome-toast";
import {
  buildSessionViewerIdentity,
  type SlackProfileRowForIdentity,
  type SlackWorkspaceUserRowForIdentity,
} from "@/lib/session-viewer-identity";
import { peekAdminWelcomeParam, stripAdminWelcomeParam } from "@/lib/admin-welcome-param";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

/**
 * After admin Google OAuth, shows the same pill welcome as the company portal, using session email
 * plus Slack workspace users + author profiles (not env-only founder/bot chips).
 */
export function AdminPostAuthWelcomeBoundary() {
  const [welcome, setWelcome] = useState<{ greeting: string; portraitUrl?: string } | null>(null);
  const dismiss = useCallback(() => setWelcome(null), []);

  useEffect(() => {
    if (!peekAdminWelcomeParam()) {
      return;
    }

    let cancelled = false;

    async function run() {
      const [meRes, suRes, profRes] = await Promise.all([
        fetch("/api/admin/auth/me", { cache: "no-store" }),
        fetch("/api/admin/slack-workspace-users", { cache: "no-store" }),
        fetch("/api/admin/slack-bot-author-profiles", { cache: "no-store" }),
      ]);

      if (cancelled) {
        return;
      }

      if (kickToLoginForUnauthorizedApi(meRes.status, "admin")) {
        return;
      }

      type MePayload = { authenticated?: boolean; email?: string };
      const meJson = (await meRes.json().catch(() => null)) as MePayload | null;
      const sessionEmail = String(meJson?.email ?? "").trim().toLowerCase();

      let slackWorkspaceUsers: SlackWorkspaceUserRowForIdentity[] = [];
      if (suRes.ok) {
        const su = (await suRes.json().catch(() => null)) as { users?: SlackWorkspaceUserRowForIdentity[] } | null;
        slackWorkspaceUsers = Array.isArray(su?.users) ? su.users : [];
      }

      let profileRows: SlackProfileRowForIdentity[] = [];
      if (profRes.ok) {
        const p = (await profRes.json().catch(() => null)) as { profiles?: SlackProfileRowForIdentity[] } | null;
        profileRows = Array.isArray(p?.profiles) ? p.profiles : [];
      }

      stripAdminWelcomeParam();

      const workspaceUser =
        sessionEmail && slackWorkspaceUsers.length > 0
          ? slackWorkspaceUsers.find((u) => String(u.email ?? "").trim().toLowerCase() === sessionEmail)
          : undefined;

      const identity = sessionEmail
        ? buildSessionViewerIdentity(sessionEmail, {
            profileRows,
            workspaceUser,
          })
        : null;

      const greeting = identity
        ? `Welcome, ${identity.displayName}!`
        : "Welcome! You're signed in to the admin dashboard.";

      setWelcome({ greeting, portraitUrl: identity?.portraitUrl });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return <PortalPostAuthWelcomeToast welcome={welcome} onDismiss={dismiss} />;
}

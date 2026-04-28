"use client";

import { useEffect } from "react";

import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

const STORAGE_PREFIX = "mac_local_docker_humans_welcome_fired:";
const POLL_LOCK_PREFIX = "mac_local_docker_humans_welcome_poll:";

const isLocalDockerProfile = () =>
  String(process.env.NEXT_PUBLIC_COMPOSE_PROFILE_LOCAL ?? "").trim() === "1";

function targetEmailFromEnv(): string {
  return String(process.env.NEXT_PUBLIC_LOCAL_DOCKER_AUTO_HUMANS_WELCOME_EMAIL ?? "").trim().toLowerCase();
}

type SlackUserRow = { email?: string };

type SlackUsersPayload = { users?: SlackUserRow[]; error?: string; message?: string };

async function fetchSlackWorkspaceUsers(): Promise<SlackUsersPayload | null> {
  const res = await fetch("/api/admin/slack-workspace-users", { cache: "no-store" });
  if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
    return null;
  }
  return (await res.json().catch(() => null)) as SlackUsersPayload | null;
}

function hasUserEmail(users: SlackUserRow[], email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  for (const u of users) {
    const uEmail = String(u.email ?? "")
      .trim()
      .toLowerCase();
    if (uEmail && uEmail === e) return true;
  }
  return false;
}

/**
 * When running `docker compose --profile local` with NEXT_PUBLIC_COMPOSE_PROFILE_LOCAL and a target
 * email set, fetches Slack workspace users until that member appears in the snapshot, then POSTs the
 * Joanne #humans welcome once per browser tab (sessionStorage done key).
 */
export function AdminLocalDockerHumansWelcomeAuto() {
  const flash = useAdminFlashToast();

  useEffect(() => {
    if (!isLocalDockerProfile() || typeof window === "undefined") {
      return;
    }
    const email = targetEmailFromEnv();
    if (!email) {
      return;
    }
    const doneKey = `${STORAGE_PREFIX}${email}`;
    const pollKey = `${POLL_LOCK_PREFIX}${email}`;
    if (window.sessionStorage.getItem(doneKey) === "1") {
      return;
    }
    if (window.sessionStorage.getItem(pollKey)) {
      return;
    }
    window.sessionStorage.setItem(pollKey, "1");

    let cancelled = false;

    async function run() {
      const maxAttempts = 8;
      const delayMs = 1200;

      function releasePollLockIfNotDone() {
        if (typeof window === "undefined") return;
        if (window.sessionStorage.getItem(doneKey) !== "1") {
          window.sessionStorage.removeItem(pollKey);
        }
      }

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (cancelled) {
            releasePollLockIfNotDone();
            return;
          }

          const payload = await fetchSlackWorkspaceUsers();
          if (cancelled || payload == null) {
            releasePollLockIfNotDone();
            return;
          }

          const users = Array.isArray(payload.users) ? payload.users : [];
          const hasSnapshot = users.length > 0 && hasUserEmail(users, email);

          if (hasSnapshot) {
            if (cancelled) {
              releasePollLockIfNotDone();
              return;
            }

            const res = await fetch("/api/admin/joanne-humans-welcome-trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, force: true }),
              cache: "no-store",
            });
            if (cancelled) {
              releasePollLockIfNotDone();
              return;
            }
            if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
              releasePollLockIfNotDone();
              return;
            }
            const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; slackUserId?: string };
            if (!res.ok) {
              releasePollLockIfNotDone();
              flash("error", body.error ?? `Welcome auto-trigger failed (HTTP ${res.status})`);
              return;
            }
            window.sessionStorage.setItem(doneKey, "1");
            window.sessionStorage.removeItem(pollKey);
            flash(
              "success",
              body.slackUserId
                ? `Local docker: #humans welcome sent for ${email} (Slack ${body.slackUserId}).`
                : `Local docker: Joanne posted the welcome + terms in #humans for ${email}.`,
            );
            return;
          }

          await new Promise((r) => {
            setTimeout(r, delayMs);
          });
        }
        releasePollLockIfNotDone();
      } catch {
        releasePollLockIfNotDone();
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && window.sessionStorage.getItem(doneKey) !== "1") {
        window.sessionStorage.removeItem(pollKey);
      }
    };
  }, [flash]);

  return null;
}

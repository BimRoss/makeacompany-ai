"use client";

import { useCallback, useState } from "react";

import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

function looksLikeEmail(value: string): boolean {
  const t = value.trim();
  return t.length > 0 && t.includes("@") && !t.startsWith("@") && !t.endsWith("@");
}

function defaultWelcomeEmailFromEnv(): string {
  if (String(process.env.NEXT_PUBLIC_COMPOSE_PROFILE_LOCAL ?? "").trim() !== "1") {
    return "";
  }
  return String(process.env.NEXT_PUBLIC_LOCAL_DOCKER_AUTO_HUMANS_WELCOME_EMAIL ?? "").trim();
}

export function AdminJoanneWelcomeTriggerCard() {
  const flash = useAdminFlashToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(defaultWelcomeEmailFromEnv);

  const trigger = useCallback(async () => {
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      flash("error", "Enter a valid user email to match their profile.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/joanne-humans-welcome-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, force: true }),
        cache: "no-store",
      });
      if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
        return;
      }
      const body = (await res.json()) as { ok?: boolean; error?: string; slackUserId?: string };
      if (!res.ok) {
        flash("error", body.error ?? `Welcome trigger failed (HTTP ${res.status})`);
        return;
      }
      flash(
        "success",
        body.slackUserId
          ? `Welcome sent for Slack user ${body.slackUserId}.`
          : "Joanne posted the welcome + terms thread in #humans.",
      );
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Welcome trigger request failed");
    } finally {
      setLoading(false);
    }
  }, [email, flash]);

  const canSubmit = looksLikeEmail(email);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="admin-joanne-welcome-email">
        User email for welcome trigger
      </label>
      <input
        id="admin-joanne-welcome-email"
        type="email"
        name="email"
        inputMode="email"
        autoComplete="email"
        placeholder="user@example.com"
        value={email}
        disabled={loading}
        onChange={(e) => setEmail(e.target.value)}
        className="h-10 w-full max-w-[14rem] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:max-w-[16rem]"
        aria-label="User email for welcome trigger"
      />
      <button
        type="button"
        disabled={loading || !canSubmit}
        onClick={() => void trigger()}
        className="shrink-0 rounded-xl border border-border bg-muted/50 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        aria-label="Accept terms message: post Joanne welcome thread in #humans"
      >
        {loading ? "Sending…" : "Accept Terms Message"}
      </button>
    </div>
  );
}

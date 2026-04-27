"use client";

import { useCallback, useState } from "react";

import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

export function AdminJoanneWelcomeTriggerCard() {
  const flash = useAdminFlashToast();
  const [loading, setLoading] = useState(false);

  const trigger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/joanne-humans-welcome-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
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
  }, [flash]);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void trigger()}
      className="rounded-xl border border-border bg-muted/50 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      aria-label="Trigger Joanne humans channel welcome message (test)"
    >
      {loading ? "Sending…" : "Trigger welcome message"}
    </button>
  );
}

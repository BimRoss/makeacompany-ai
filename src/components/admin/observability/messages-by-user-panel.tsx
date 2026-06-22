"use client";

import { useEffect, useMemo, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

type SlackProfileRow = {
  slackUserId: string;
  username?: string;
  realName?: string;
  displayName?: string;
  isBot?: boolean;
  isDeleted?: boolean;
};

type SlackProfilesPayload = { users?: SlackProfileRow[] };

type EngagementTopRow = { slack_user_id: string; total_messages: number };

type EngagementTopPayload = { users?: EngagementTopRow[] };

type Row = {
  slackUserId: string;
  name: string;
  isBot: boolean;
  messages: number;
};

function pickDisplayName(profile: SlackProfileRow | undefined, fallback: string): string {
  const candidates = [profile?.displayName, profile?.realName, profile?.username];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return fallback;
}

export function MessagesByUserBarChart() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [profilesRes, engRes] = await Promise.all([
          fetch("/api/admin/slack-workspace-users", { cache: "no-store" }),
          fetch("/api/admin/user-engagement/top?limit=500", { cache: "no-store" }),
        ]);
        if (kickToLoginForUnauthorizedApi(profilesRes.status, "admin")) return;
        if (kickToLoginForUnauthorizedApi(engRes.status, "admin")) return;
        if (!profilesRes.ok || !engRes.ok) {
          if (!cancelled) setErrored(true);
          return;
        }
        const profiles = (await profilesRes.json()) as SlackProfilesPayload;
        const eng = (await engRes.json()) as EngagementTopPayload;
        const byId = new Map<string, SlackProfileRow>();
        for (const p of profiles.users ?? []) {
          if (p.slackUserId) byId.set(p.slackUserId, p);
        }
        const merged: Row[] = [];
        for (const e of eng.users ?? []) {
          if (!e.slack_user_id) continue;
          const messages = typeof e.total_messages === "number" ? e.total_messages : 0;
          if (messages <= 0) continue;
          const profile = byId.get(e.slack_user_id);
          if (profile?.isDeleted) continue;
          merged.push({
            slackUserId: e.slack_user_id,
            name: pickDisplayName(profile, e.slack_user_id),
            isBot: profile?.isBot === true,
            messages,
          });
        }
        merged.sort((a, b) => b.messages - a.messages);
        if (!cancelled) {
          setRows(merged);
          setErrored(false);
        }
      } catch {
        if (!cancelled) setErrored(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const max = useMemo(() => Math.max(1, ...(rows ?? []).map((r) => r.messages)), [rows]);

  if (errored && (rows === null || rows.length === 0)) {
    return null;
  }
  if (rows !== null && rows.length === 0) {
    return null;
  }

  const botCount = rows?.filter((r) => r.isBot).length ?? 0;
  const humanCount = rows ? rows.length - botCount : 0;

  return (
    <section
      aria-label="Messages by Slack user"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">Messages by user</h2>
        <p className="text-xs text-muted-foreground">
          {rows === null
            ? "Loading…"
            : `${humanCount} human${humanCount === 1 ? "" : "s"} · ${botCount} bot${botCount === 1 ? "" : "s"}, sorted by messages sent`}
        </p>
      </div>
      {rows === null ? (
        <div className="space-y-1.5" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => {
            const pct = (r.messages / max) * 100;
            return (
              <div
                key={r.slackUserId}
                className="flex items-center gap-2 text-xs"
                title={`${r.name} — ${r.messages.toLocaleString()} messages`}
              >
                <span className="w-40 shrink-0 truncate text-foreground sm:w-52">{r.name}</span>
                <span
                  className={
                    "w-12 shrink-0 rounded py-0.5 text-center text-[10px] font-medium " +
                    (r.isBot
                      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")
                  }
                >
                  {r.isBot ? "bot" : "human"}
                </span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className={"h-full " + (r.isBot ? "bg-blue-500/60" : "bg-emerald-500/60")}
                    style={{ width: `${pct.toFixed(2)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
                  {r.messages.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

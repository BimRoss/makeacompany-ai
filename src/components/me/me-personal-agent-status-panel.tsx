"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AgentStatus = {
  hasAgent: boolean;
  agentId?: string;
  displayName?: string;
  description?: string;
  slackAppId?: string;
  status?: string;
  installUrl?: string;
};

const TERMINAL_STATUSES = new Set(["installed", "failed"]);

export function MePersonalAgentStatusPanel({ initial }: { initial: AgentStatus }) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentStatus>(initial);

  useEffect(() => {
    if (!agent.hasAgent || (agent.status && TERMINAL_STATUSES.has(agent.status))) {
      return;
    }
    // Poll every 4s while pending_install. Cap at ~5min so we don't loop forever.
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/me/personal-agents/mine", { cache: "no-store" });
        const payload = (await res.json().catch(() => null)) as AgentStatus | null;
        if (cancelled) return;
        if (payload?.hasAgent) {
          setAgent(payload);
          if (payload.status && TERMINAL_STATUSES.has(payload.status)) {
            router.refresh();
            return;
          }
        }
      } catch {
        /* swallow — try again on next tick */
      }
      if (Date.now() - startedAt < 5 * 60 * 1000 && !cancelled) {
        setTimeout(tick, 4000);
      }
    };
    const handle = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [agent.hasAgent, agent.status, router]);

  if (!agent.hasAgent) {
    return null;
  }

  const status = agent.status ?? "unknown";

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border/60 text-sm">
        <Row label="Agent" value={agent.displayName ?? "—"} />
        <Row label="Slack app" value={agent.slackAppId ?? "—"} mono />
        <Row label="Status" value={status} mono />
      </dl>
      {status === "pending_install" && agent.installUrl ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Finish installing your Slack app to bring this agent online.</p>
          <a
            href={agent.installUrl}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
          >
            Install in Slack
          </a>
        </div>
      ) : null}
      {status === "installed" ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Your agent is live. DM @{agent.displayName ?? "your agent"} in Slack to start.
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          Install didn&apos;t complete. Please retry; if it keeps failing, ping support.
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-foreground ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

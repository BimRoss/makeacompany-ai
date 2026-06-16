"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MePersonalAgentIconPicker, type IconPickerValue } from "@/components/me/me-personal-agent-icon-picker";

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
        <>
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            Your agent is live. DM @{agent.displayName ?? "your agent"} in Slack to start.
          </p>
          <ChangeIconSection displayName={agent.displayName ?? ""} description={agent.description ?? ""} />
        </>
      ) : null}
      {status === "failed" ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          Install didn&apos;t complete. Please retry; if it keeps failing, ping support.
        </p>
      ) : null}
    </div>
  );
}

function ChangeIconSection({ displayName, description }: { displayName: string; description: string }) {
  const [icon, setIcon] = useState<IconPickerValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const preview = icon ? `data:${icon.mimeType};base64,${icon.base64}` : null;

  async function submit(payload: { iconBase64?: string; iconMimeType?: string; regenerate?: boolean }) {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/me/personal-agents/icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setFeedback({ kind: "err", message: body.error || `Failed (${res.status})` });
        return;
      }
      setFeedback({ kind: "ok", message: "Icon updated in Slack. May take a moment to refresh in clients." });
      setIcon(null);
    } catch (err) {
      setFeedback({ kind: "err", message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">Change icon</h3>
      <MePersonalAgentIconPicker
        previewDataUrl={preview}
        onChange={setIcon}
        disabled={submitting}
        displayName={displayName}
        description={description}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => submit({ regenerate: true })}
          disabled={submitting}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Working..." : "Regenerate & push"}
        </button>
        <button
          type="button"
          onClick={() => icon && submit({ iconBase64: icon.base64, iconMimeType: icon.mimeType })}
          disabled={submitting || !icon}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Push selected
        </button>
      </div>
      {feedback ? (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            feedback.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          }`}
        >
          {feedback.message}
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

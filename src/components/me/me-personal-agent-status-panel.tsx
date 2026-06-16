"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MePersonalAgentEditForm, PenIcon } from "@/components/me/me-personal-agent-edit-form";

type AgentStatus = {
  hasAgent: boolean;
  agentId?: string;
  displayName?: string;
  description?: string;
  longDescription?: string;
  systemPrompt?: string;
  slackAppId?: string;
  status?: string;
  installUrl?: string;
};

const TERMINAL_STATUSES = new Set(["installed", "failed"]);

export function MePersonalAgentStatusPanel({
  initial,
  ownerName,
  ownerSlackUserId,
}: {
  initial: AgentStatus;
  ownerName: string;
  ownerSlackUserId: string;
}) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentStatus>(initial);
  const [editOpen, setEditOpen] = useState(false);
  const [liveSlackIconUrl, setLiveSlackIconUrl] = useState<string | null>(null);

  // Card-header source of truth — same /icon-current call the ChangeIconSection
  // uses. Hoisted here so the card avatar reflects what Slack actually serves.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/me/personal-agents/icon-current", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => ({}))) as { imageUrl?: string };
        if (cancelled) return;
        const url = (payload.imageUrl ?? "").trim();
        setLiveSlackIconUrl(url || null);
      } catch {
        /* network blip — leave whatever we had */
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [agent.status]);

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
  const name = (agent.displayName ?? "").trim() || "Not set";
  const previewDescription =
    (agent.description ?? "").trim() ||
    (agent.longDescription ?? "").trim() ||
    (agent.systemPrompt ?? "").trim().split("\n")[0] ||
    "No description yet";

  const refreshLiveSlackIcon = async () => {
    setLiveSlackIconUrl(null);
    try {
      // Short delay to let Slack ingest before we re-query users.info.
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch("/api/me/personal-agents/icon-current", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json().catch(() => ({}))) as { imageUrl?: string };
      const url = (payload.imageUrl ?? "").trim();
      setLiveSlackIconUrl(url || null);
    } catch {
      /* swallow */
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-4 sm:gap-4 sm:px-5 sm:py-5">
        <div
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/90 text-xl font-semibold text-background"
        >
          {liveSlackIconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Slack CDN URL, skip next/image
            <img src={liveSlackIconUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span>{(name.trim()[0] ?? "?").toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {name}
          </h2>
          <p className="truncate text-sm text-muted-foreground" title={previewDescription}>
            {previewDescription}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatusPill status={status} />
        </div>
      </header>

      <dl className="divide-y divide-border/60 px-4 py-2 text-sm sm:px-5">
        <Row label="Slack app" value={agent.slackAppId?.trim() || "Not set"} mono />
        <Row label="Status" value={status} mono />
      </dl>

      {status === "pending_install" && agent.installUrl ? (
        <div className="space-y-2 border-t border-border/60 px-4 py-4 sm:px-5">
          <p className="text-sm text-muted-foreground">
            Finish installing your Slack app to bring this agent online.
          </p>
          <a
            href={agent.installUrl}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
          >
            Install in Slack
          </a>
        </div>
      ) : null}

      {status === "installed" ? (
        <div className="space-y-4 border-t border-border/60 px-4 py-4 sm:px-5">
          {editOpen ? (
            <MePersonalAgentEditForm
              agentId={agent.agentId ?? agent.slackAppId ?? ""}
              initialName={agent.displayName ?? ""}
              initialDescription={agent.description ?? ""}
              initialLongDescription={agent.longDescription ?? ""}
              initialSystemPrompt={agent.systemPrompt ?? ""}
              liveSlackIconUrl={liveSlackIconUrl}
              ownerName={ownerName}
              ownerSlackUserId={ownerSlackUserId}
              onCancel={() => setEditOpen(false)}
              onSaved={(displayName, desc, longDesc, systemPrompt) => {
                setAgent((a) => ({
                  ...a,
                  displayName,
                  description: desc,
                  longDescription: longDesc,
                  systemPrompt,
                }));
                setEditOpen(false);
              }}
              onIconPushed={() => void refreshLiveSlackIcon()}
              onDeleted={() => router.refresh()}
            />
          ) : (
            <>
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                Your agent is live. DM @{name} in Slack to start.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border-2 border-foreground/15 bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <PenIcon />
                  Edit agent
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="border-t border-border/60 px-4 py-4 sm:px-5">
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            Install didn&apos;t complete. Please retry; if it keeps failing, ping support.
          </p>
        </div>
      ) : null}

    </section>
  );
}

const STATUS_TONE: Record<string, "positive" | "warning" | "danger" | "neutral"> = {
  installed: "positive",
  pending_install: "warning",
  failed: "danger",
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const cls =
    tone === "positive"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "danger"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
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

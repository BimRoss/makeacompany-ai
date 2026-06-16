"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MePersonalAgentEditModal, PenIcon } from "@/components/me/me-personal-agent-edit-modal";
import { MePersonalAgentIconPicker, type IconPickerValue } from "@/components/me/me-personal-agent-icon-picker";

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

  const previewDescription =
    (agent.description ?? "").trim() ||
    (agent.longDescription ?? "").trim() ||
    (agent.systemPrompt ?? "").trim().split("\n")[0] ||
    "No description yet. Edit to add one.";

  return (
    <div className="space-y-4">
      {status === "installed" ? (
        <AgentCardHeader
          name={agent.displayName ?? "—"}
          previewDescription={previewDescription}
          iconUrl={liveSlackIconUrl}
          onEdit={() => setEditOpen(true)}
        />
      ) : null}
      <dl className="divide-y divide-border/60 text-sm">
        {status !== "installed" ? <Row label="Agent" value={agent.displayName ?? "—"} /> : null}
        <Row label="Slack app" value={agent.slackAppId ?? "—"} mono />
        <Row label="Status" value={status} mono />
      </dl>
      <MePersonalAgentEditModal
        open={editOpen}
        initialName={agent.displayName ?? ""}
        initialDescription={agent.description ?? ""}
        initialLongDescription={agent.longDescription ?? ""}
        initialSystemPrompt={agent.systemPrompt ?? ""}
        ownerName={ownerName}
        ownerSlackUserId={ownerSlackUserId}
        onClose={() => setEditOpen(false)}
        onSaved={(name, desc, longDesc, systemPrompt) =>
          setAgent((a) => ({
            ...a,
            displayName: name,
            description: desc,
            longDescription: longDesc,
            systemPrompt,
          }))
        }
        onDeleted={() => router.refresh()}
      />
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
          <ChangeIconSection
            agentId={agent.agentId ?? agent.slackAppId ?? ""}
            displayName={agent.displayName ?? ""}
            description={agent.description ?? ""}
            onPushed={() => {
              // Refresh the card-header avatar after a successful push so the
              // new Slack-side URL becomes the source of truth.
              setLiveSlackIconUrl(null);
              setTimeout(() => {
                void (async () => {
                  try {
                    const res = await fetch("/api/me/personal-agents/icon-current", { cache: "no-store" });
                    if (!res.ok) return;
                    const payload = (await res.json().catch(() => ({}))) as { imageUrl?: string };
                    const url = (payload.imageUrl ?? "").trim();
                    setLiveSlackIconUrl(url || null);
                  } catch {
                    /* swallow */
                  }
                })();
              }, 200);
            }}
          />
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

function AgentCardHeader({
  name,
  previewDescription,
  iconUrl,
  onEdit,
}: {
  name: string;
  previewDescription: string;
  iconUrl: string | null;
  onEdit: () => void;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <header className="-mx-5 -mt-5 mb-1 flex flex-wrap items-center gap-4 border-b border-border/60 bg-muted/20 px-5 py-5">
      <div
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/90 text-xl font-semibold text-background"
      >
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Slack CDN URL, skip next/image
          <img src={iconUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{initial}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">{name}</h3>
        <p className="truncate text-sm text-muted-foreground" title={previewDescription}>
          {previewDescription}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted/40"
        aria-label="Edit agent details"
      >
        <PenIcon />
        Edit
      </button>
    </header>
  );
}

function RowWithAction({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-foreground" title={value}>
        <span className="truncate">{value}</span>
        {action}
      </dd>
    </div>
  );
}

function lastIconStorageKey(agentId: string): string {
  return `mac.pa.icon.${agentId}`;
}

function ChangeIconSection({
  agentId,
  displayName,
  description,
  onPushed,
}: {
  agentId: string;
  displayName: string;
  description: string;
  onPushed?: () => void;
}) {
  const [icon, setIcon] = useState<IconPickerValue | null>(null);
  const [liveSlackIconUrl, setLiveSlackIconUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  // Hydrate the last-pushed icon from localStorage as a fallback so a full
  // reload keeps showing something even if Slack is slow / down.
  useEffect(() => {
    if (!agentId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(lastIconStorageKey(agentId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as IconPickerValue | null;
      if (parsed?.base64 && parsed.mimeType) {
        setIcon(parsed);
      }
    } catch {
      /* corrupt entry — ignore, next push will overwrite */
    }
  }, [agentId]);

  // Pull the live Slack-side icon URL on mount + after each push. Source of
  // truth — beats the localStorage cache when both are present. Silently
  // tolerated on failure: cache + the user's pending icon still render.
  const refreshLiveIcon = useCallback(async () => {
    try {
      const res = await fetch("/api/me/personal-agents/icon-current", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json().catch(() => ({}))) as { imageUrl?: string };
      const url = (payload.imageUrl ?? "").trim();
      setLiveSlackIconUrl(url || null);
    } catch {
      /* network blip — keep showing whatever we already have */
    }
  }, []);

  useEffect(() => {
    void refreshLiveIcon();
  }, [refreshLiveIcon]);

  const cacheIcon = useCallback(
    (next: IconPickerValue | null) => {
      if (!agentId || typeof window === "undefined") return;
      try {
        if (next) {
          window.localStorage.setItem(lastIconStorageKey(agentId), JSON.stringify(next));
        } else {
          window.localStorage.removeItem(lastIconStorageKey(agentId));
        }
      } catch {
        /* quota / privacy mode — preview will just not survive reload */
      }
    },
    [agentId],
  );

  const onIconChange = useCallback(
    (next: IconPickerValue | null) => {
      setIcon(next);
      // Don't churn the cache on every keystroke — only the final picked
      // value gets persisted via the submit path below. Local clear from
      // the picker (next === null) should clear the cache too.
      if (next === null) {
        cacheIcon(null);
      }
    },
    [cacheIcon],
  );

  // Display priority: a staged-but-unpushed pick > live Slack URL > cached
  // last-pushed bytes. Staged pick beats live URL so the user sees what
  // they're ABOUT to push (which is what they actually care about).
  const stagedDataUrl = icon ? `data:${icon.mimeType};base64,${icon.base64}` : null;
  const preview = stagedDataUrl ?? liveSlackIconUrl ?? null;

  async function submit(payload: { iconBase64?: string; iconMimeType?: string; regenerate?: boolean }) {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/me/personal-agents/icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        imageBase64?: string;
        mimeType?: string;
      };
      if (!res.ok || !body.ok) {
        setFeedback({ kind: "err", message: body.error || `Failed (${res.status})` });
        return;
      }
      // Prefer the server-echoed bytes (covers the regenerate path where
      // we don't have the new bytes client-side) and fall back to whatever
      // is already in state for the upload / pick-candidate paths.
      const persisted: IconPickerValue | null =
        body.imageBase64 && body.mimeType
          ? { base64: body.imageBase64, mimeType: body.mimeType }
          : icon;
      if (persisted) {
        setIcon(persisted);
        cacheIcon(persisted);
      }
      // Re-pull the live Slack URL so the preview reflects what Slack actually
      // serves (avatars.slack-edge.com path changes once Slack ingests the new bytes).
      void refreshLiveIcon();
      onPushed?.();
      setFeedback({ kind: "ok", message: "Icon updated in Slack. May take a moment to refresh in clients." });
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
        onChange={onIconChange}
        disabled={submitting}
        displayName={displayName}
        description={description}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => icon && submit({ iconBase64: icon.base64, iconMimeType: icon.mimeType })}
          disabled={submitting || !icon}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save"}
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

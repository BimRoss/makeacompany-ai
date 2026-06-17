"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TerminalSquare } from "lucide-react";

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
        {agent.description?.trim() ? (
          <Row label="Description" value={agent.description.trim()} />
        ) : null}
        {agent.longDescription?.trim() ? (
          <Row label="Long description" value={agent.longDescription.trim()} />
        ) : null}
        {agent.systemPrompt?.trim() ? (
          <Row label="Personality" value={agent.systemPrompt.trim().replace(/\s+/g, " ")} />
        ) : null}
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

      {status === "installed" && editOpen ? (
        <div className="space-y-4 border-t border-border/60 px-4 py-4 sm:px-5">
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
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="border-t border-border/60 px-4 py-4 sm:px-5">
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            Install didn&apos;t complete. Please retry; if it keeps failing, ping support.
          </p>
        </div>
      ) : null}

      <ConnectionsFooter
        showEdit={status === "installed" && !editOpen}
        onEdit={() => setEditOpen(true)}
      />
    </section>
  );
}

function ConnectionsFooter({
  showEdit,
  onEdit,
}: {
  showEdit: boolean;
  onEdit: () => void;
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const announce = (label: string) => setToast(`${label} — coming soon`);

  return (
    <footer className="border-t border-border/60 bg-muted/10 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Connections
        </p>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <ConnectChip label="GitHub" icon={<GitHubGlyph />} onClick={announce} />
          <ConnectChip label="Google" icon={<GoogleGlyph />} onClick={announce} />
          <ConnectChip label="Shopify" icon={<ShopifyGlyph />} onClick={announce} />
          <ConnectChip label="Cloudflare" icon={<CloudflareGlyph />} onClick={announce} />
          <ConnectChip
            label="SSH"
            icon={<TerminalSquare className="h-4 w-4 text-foreground/80" aria-hidden />}
            onClick={announce}
          />
        </div>
        {showEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-xs font-medium text-foreground transition hover:border-foreground/30 hover:bg-muted/50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            <PenIcon />
            Edit
          </button>
        ) : null}
      </div>
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <p
            role="status"
            className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium text-foreground shadow-lg"
          >
            {toast}
          </p>
        </div>
      ) : null}
    </footer>
  );
}

function ConnectChip({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: (label: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(label)}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-xs font-medium text-foreground transition hover:border-foreground/30 hover:bg-muted/50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center">
        {icon}
      </span>
      {label}
    </button>
  );
}

function GitHubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="text-foreground">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.08 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.6.23 2.78.11 3.08.75.81 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.77 1.06.77 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84a10.13 10.13 0 0 1-4.4 6.64v5.52h7.11c4.17-3.84 6.57-9.5 6.57-16.17Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.93-1.97 14.57-5.33l-7.11-5.52c-1.97 1.32-4.5 2.1-7.46 2.1-5.74 0-10.6-3.87-12.34-9.07H4.34v5.7A22 22 0 0 0 24 46Z"
      />
      <path
        fill="#FBBC04"
        d="M11.66 28.18a13.2 13.2 0 0 1 0-8.36v-5.7H4.34a22 22 0 0 0 0 19.76l7.32-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.75c3.23 0 6.13 1.11 8.42 3.29l6.3-6.3C34.93 3.05 29.94 1 24 1A22 22 0 0 0 4.34 14.12l7.32 5.7C13.4 13.62 18.26 9.75 24 9.75Z"
      />
    </svg>
  );
}

function ShopifyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 109.5 124.5" aria-hidden>
      <path
        fill="#95BF47"
        d="M95.9 23.9c-.1-.6-.6-1-1.1-1-.5 0-9.3-.2-9.3-.2s-7.4-7.2-8.2-8c-.7-.7-2.2-.5-2.7-.3 0 0-1.4.4-3.7 1.1-.4-1.3-1-2.8-1.8-4.4-2.6-5-6.5-7.7-11.1-7.7-.3 0-.6 0-1 .1-.1-.2-.3-.3-.4-.5C54.5 1 51.9 0 48.8 0c-6 .2-12 4.5-16.8 12.2-3.4 5.4-6 12.2-6.7 17.5-6.9 2.1-11.7 3.6-11.8 3.7-3.5 1.1-3.6 1.2-4 4.5-.4 2.5-9.6 73.9-9.6 73.9l77.1 13.3 33.4-8.3S96 24.5 95.9 23.9zM68.5 17c-1.7.5-3.7 1.2-5.8 1.8 0-3.1-.4-7.3-1.8-11 4.5.8 6.7 5.9 7.6 9.2zm-9.5 2.9c-4 1.2-8.3 2.6-12.7 4 1.2-4.7 3.5-9.4 6.3-12.5 1-1.2 2.5-2.5 4.2-3.2 1.7 3.4 2.1 8.2 2.2 11.7zm-9.7-18.4c1.4 0 2.5.3 3.5.9-1.6.8-3.2 2.1-4.7 3.7-3.7 4-6.6 10.3-7.7 16.3-3.6 1.1-7.2 2.2-10.4 3.2 2-9.6 10.1-23.8 19.3-24.1z"
      />
      <path
        fill="#5E8E3E"
        d="M94.8 22.9c-.5 0-9.3-.2-9.3-.2s-7.4-7.2-8.2-8c-.3-.3-.7-.5-1.1-.5l-5.8 117.8 33.4-8.3S96 24.5 95.9 23.9c-.1-.6-.6-1-1.1-1z"
      />
      <path
        fill="#FFF"
        d="M58.5 41.1l-3.9 14.5s-4.3-2-9.5-1.6c-7.6.5-7.7 5.3-7.6 6.5.4 6.5 17.6 8 18.6 23.4.8 12.1-6.4 20.4-16.7 21-12.4.8-19.2-6.5-19.2-6.5l2.6-11.2s6.8 5.2 12.3 4.8c3.6-.2 4.9-3.2 4.8-5.3-.5-8.5-14.5-8-15.5-22-.7-11.9 7.1-23.9 24.2-25 6.5-.4 9.9 1.4 9.9 1.4z"
      />
    </svg>
  );
}

function CloudflareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden>
      <path
        fill="#F38020"
        d="M46.4 41.2 33.6 24.4l-1.6 6.4-13.6 17.6h26.4z"
      />
      <path
        fill="#FAAD3F"
        d="M51.2 21.6c-.4 0-.8 0-1.2.1-2-5.8-7.5-10-14-10-7.7 0-14 5.9-14.8 13.4-1.2-.6-2.6-.9-4-.9C12 24.2 8 28.2 8 33.4S12 42.6 17.2 42.6h34c4.7 0 8.6-3.8 8.6-8.6 0-4.6-3.9-8.4-8.6-8.4z"
      />
    </svg>
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


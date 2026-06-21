"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TerminalSquare } from "lucide-react";

import {
  MePersonalAgentIconPicker,
  type IconPickerValue,
} from "@/components/me/me-personal-agent-icon-picker";
import {
  MePersonalAgentYouTubeIngest,
  type YtSource,
} from "@/components/me/me-personal-agent-youtube-ingest";
import { readCachedAgentIcon, writeCachedAgentIcon } from "@/lib/personal-agent-icon-cache";

type AgentStatus = {
  hasAgent: boolean;
  agentId?: string;
  displayName?: string;
  description?: string;
  longDescription?: string;
  systemPrompt?: string;
  youtubeSources?: YtSource[];
  slackAppId?: string;
  status?: string;
  installUrl?: string;
};

type Field = "name" | "description" | "longDescription" | "systemPrompt";

const TERMINAL_STATUSES = new Set(["installed", "failed"]);

export function MePersonalAgentStatusPanel({
  initial,
  ownerName,
  ownerSlackUserId,
  ownerEmail,
}: {
  initial: AgentStatus;
  ownerName: string;
  ownerSlackUserId: string;
  ownerEmail: string;
}) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentStatus>(initial);
  const [editOpen, setEditOpen] = useState(false);
  const [liveSlackIconUrl, setLiveSlackIconUrl] = useState<string | null>(null);

  const [name, setName] = useState(initial.displayName ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [longDescription, setLongDescription] = useState(initial.longDescription ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt ?? "");
  const [icon, setIcon] = useState<IconPickerValue | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState<Field | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  // Delete-confirm UI lives between the form rows and the footer when armed.
  // The trigger button itself sits in the footer alongside Cancel/Save —
  // see ConnectionsFooter's edit-mode actions row.
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    if (!savedToast) return;
    const t = setTimeout(() => setSavedToast(null), 2500);
    return () => clearTimeout(t);
  }, [savedToast]);

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
        /* swallow */
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

  // Hydrate the last-staged icon from localStorage so refresh keeps the preview.
  // This is also how a just-created agent's icon shows pre-install: the creation
  // form writes the same cache, keyed on agentId (falling back to slackAppId).
  useEffect(() => {
    const cached = readCachedAgentIcon(agent.agentId ?? agent.slackAppId);
    if (cached) setIcon(cached);
  }, [agent.agentId, agent.slackAppId]);

  const cacheIcon = useCallback(
    (next: IconPickerValue | null) => {
      writeCachedAgentIcon(agent.agentId ?? agent.slackAppId, next);
    },
    [agent.agentId, agent.slackAppId],
  );

  const onIconChange = useCallback(
    (next: IconPickerValue | null) => {
      setIcon(next);
      cacheIcon(next);
    },
    [cacheIcon],
  );

  const refreshLiveSlackIcon = useCallback(async () => {
    setLiveSlackIconUrl(null);
    try {
      await new Promise((r) => setTimeout(r, 200));
      const res = await fetch("/api/me/personal-agents/icon-current", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json().catch(() => ({}))) as { imageUrl?: string };
      const url = (payload.imageUrl ?? "").trim();
      setLiveSlackIconUrl(url || null);
    } catch {
      /* swallow */
    }
  }, []);

  const enterEdit = () => {
    setName(agent.displayName ?? "");
    setDescription(agent.description ?? "");
    setLongDescription(agent.longDescription ?? "");
    setSystemPrompt(agent.systemPrompt ?? "");
    setFeedback(null);
    setIconPickerOpen(false);
    setEditOpen(true);
  };

  const exitEdit = () => {
    setEditOpen(false);
    setIconPickerOpen(false);
    setFeedback(null);
    setDeleteArmed(false);
  };

  async function suggest(field: Field) {
    setSuggesting(field);
    setFeedback(null);
    try {
      const res = await fetch("/api/me/personal-agents/text-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          name,
          description,
          longDescription,
          systemPrompt,
          ownerName,
          ownerSlackUserId,
          ...(field === "systemPrompt" && icon
            ? { iconBase64: icon.base64, iconMimeType: icon.mimeType }
            : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !body.text) {
        setFeedback({ kind: "err", message: body.error || `Suggestion failed (${res.status})` });
        return;
      }
      if (field === "name") setName(body.text);
      else if (field === "description") setDescription(body.text);
      else if (field === "longDescription") setLongDescription(body.text);
      else setSystemPrompt(body.text);
    } catch (err) {
      setFeedback({ kind: "err", message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSuggesting(null);
    }
  }

  async function save() {
    if (!name.trim() || !description.trim()) {
      setFeedback({ kind: "err", message: "Name and short description are required." });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/me/personal-agents/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name.trim(),
          description: description.trim(),
          longDescription: longDescription.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        displayName?: string;
        description?: string;
        systemPrompt?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setFeedback({ kind: "err", message: body.error || `Failed (${res.status})` });
        return;
      }

      if (icon) {
        const iconRes = await fetch("/api/me/personal-agents/icon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ iconBase64: icon.base64, iconMimeType: icon.mimeType }),
        });
        const iconBody = (await iconRes.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          imageBase64?: string;
          mimeType?: string;
        };
        if (!iconRes.ok || !iconBody.ok) {
          setFeedback({ kind: "err", message: iconBody.error || `Icon sync failed (${iconRes.status})` });
          return;
        }
        const persisted: IconPickerValue =
          iconBody.imageBase64 && iconBody.mimeType
            ? { base64: iconBody.imageBase64, mimeType: iconBody.mimeType }
            : icon;
        setIcon(persisted);
        cacheIcon(persisted);
        void refreshLiveSlackIcon();
      }

      setAgent((a) => ({
        ...a,
        displayName: body.displayName ?? name.trim(),
        description: body.description ?? description.trim(),
        longDescription: longDescription.trim(),
        systemPrompt: body.systemPrompt ?? systemPrompt.trim(),
      }));
      exitEdit();
      setSavedToast(icon ? "Saved & synced to Slack" : "Saved");

      // Refetch fresh agent state so any server-side normalization (e.g.
      // longDescription stored back differently) replaces the optimistic
      // values without forcing the user to reload. Best-effort; the
      // optimistic update above already covers the common case.
      try {
        const fresh = await fetch("/api/me/personal-agents/mine", { cache: "no-store" });
        if (fresh.ok) {
          const next = (await fresh.json().catch(() => null)) as AgentStatus | null;
          if (next?.hasAgent) setAgent(next);
        }
      } catch {
        /* optimistic update is fine on its own */
      }
      if (icon) {
        // Slack icon CDN propagation can lag a beat — give it a moment, then
        // re-poll so the header avatar reflects the just-pushed image.
        setTimeout(() => void refreshLiveSlackIcon(), 800);
      }
    } catch (err) {
      setFeedback({ kind: "err", message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!agent.hasAgent) {
    return null;
  }

  const status = agent.status ?? "unknown";
  const displayName = (agent.displayName ?? "").trim() || "Not set";
  // Personality row + preview should show only the user-typed persona, not
  // the appended "Learned from videos" fence (rendered by the YT panel).
  const personaOnly = (agent.systemPrompt ?? "").trim();
  const previewDescription =
    (agent.description ?? "").trim() ||
    (agent.longDescription ?? "").trim() ||
    personaOnly.split("\n")[0] ||
    "No description yet";

  const stagedIconDataUrl = icon ? `data:${icon.mimeType};base64,${icon.base64}` : null;
  const headerImageUrl = stagedIconDataUrl ?? liveSlackIconUrl;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] transition-shadow duration-200 hover:shadow-[0_18px_50px_-12px_rgba(0,0,0,0.22)] dark:bg-zinc-950 dark:ring-white/[0.06]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-4 sm:gap-4 sm:px-5 sm:py-5">
        <button
          type="button"
          onClick={editOpen ? () => setIconPickerOpen((v) => !v) : undefined}
          disabled={!editOpen}
          aria-label={editOpen ? "Change icon" : displayName}
          className={`group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/90 text-xl font-semibold text-background ${
            editOpen ? "cursor-pointer ring-1 ring-border hover:ring-foreground/30" : ""
          }`}
        >
          {headerImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Slack/data URL, skip next/image
            <img src={headerImageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <span>{(displayName.trim()[0] ?? "?").toUpperCase()}</span>
          )}
          {editOpen ? (
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-white opacity-0 transition group-hover:opacity-100">
              {iconPickerOpen ? "Close" : "Edit"}
            </span>
          ) : null}
        </button>
        <div className="min-w-0 flex-1">
          {editOpen ? (
            <div className="relative">
              <input
                type="text"
                required
                maxLength={32}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                placeholder="Agent name"
                className="w-full min-w-0 rounded-md border border-border bg-background py-1 pl-2 pr-9 text-lg font-semibold tracking-tight text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10 sm:text-xl"
              />
              <WriteForMeIconButton
                onClick={() => suggest("name")}
                busy={suggesting === "name"}
                disabled={submitting}
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
              />
            </div>
          ) : (
            <h2 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {displayName}
            </h2>
          )}
          {editOpen ? null : (
            <p className="truncate text-sm text-muted-foreground" title={previewDescription}>
              {previewDescription}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatusPill status={status} />
        </div>
      </header>

      {editOpen ? (
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            iconPickerOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`border-b border-border/60 bg-muted/10 px-4 transition-[padding] duration-300 ease-out sm:px-5 ${
                iconPickerOpen ? "py-4" : "py-0"
              }`}
            >
              <MePersonalAgentIconPicker
                previewDataUrl={stagedIconDataUrl ?? liveSlackIconUrl}
                onChange={onIconChange}
                disabled={submitting}
                displayName={name}
                description={description}
              />
            </div>
          </div>
        </div>
      ) : null}

      <dl className="divide-y divide-border/60 px-4 py-2 text-sm sm:px-5">
        <Row label="Email" value={ownerEmail || "—"} />
        <Row label="Slack app" value={agent.slackAppId?.trim() || "Not set"} mono />
        {editOpen ? (
          <EditRow
            label="Description"
            value={description}
            onChange={setDescription}
            onSuggest={() => suggest("description")}
            suggesting={suggesting === "description"}
            disabled={submitting}
            maxLength={140}
            placeholder="One line — appears in Slack app listings."
          />
        ) : agent.description?.trim() ? (
          <Row label="Description" value={agent.description.trim()} />
        ) : null}
        {editOpen ? (
          <EditRow
            label="Long description"
            multiline
            value={longDescription}
            onChange={setLongDescription}
            onSuggest={() => suggest("longDescription")}
            suggesting={suggesting === "longDescription"}
            disabled={submitting}
            maxLength={500}
            placeholder="2-3 sentences for the Slack app detail page (175+ chars)."
          />
        ) : agent.longDescription?.trim() ? (
          <Row label="Long description" value={agent.longDescription.trim()} />
        ) : null}
        {editOpen ? (
          <EditRow
            label="Personality"
            multiline
            value={systemPrompt}
            onChange={setSystemPrompt}
            onSuggest={() => suggest("systemPrompt")}
            suggesting={suggesting === "systemPrompt"}
            disabled={submitting}
            maxLength={600}
            placeholder='A few sentences on how your agent behaves. Knowledge (videos, docs) goes below.'
          />
        ) : personaOnly ? (
          <Row label="Personality" value={personaOnly.replace(/\s+/g, " ")} />
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

      {status === "installed" && !editOpen ? (
        <MePersonalAgentYouTubeIngest
          sources={agent.youtubeSources ?? []}
          onSourcesChange={(nextSources) =>
            setAgent((a) => ({ ...a, youtubeSources: nextSources }))
          }
        />
      ) : null}

      {status === "failed" ? (
        <div className="border-t border-border/60 px-4 py-4 sm:px-5">
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            Install didn&apos;t complete. Please retry; if it keeps failing, ping support.
          </p>
        </div>
      ) : null}

      {editOpen && feedback ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <p
            className={`rounded-lg border px-3 py-2 text-xs ${
              feedback.kind === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            }`}
          >
            {feedback.message}
          </p>
        </div>
      ) : null}

      {editOpen ? (
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            deleteArmed ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <DeleteAgentConfirm
              displayName={agent.displayName?.trim() || "your agent"}
              disabled={submitting}
              onCancel={() => setDeleteArmed(false)}
              onDeleted={() => router.refresh()}
            />
          </div>
        </div>
      ) : null}

      <ConnectionsFooter
        editOpen={editOpen}
        showEdit={status === "installed" && !editOpen}
        submitting={submitting}
        onEdit={enterEdit}
        onCancel={exitEdit}
        onSave={save}
        onRequestDelete={() => setDeleteArmed(true)}
        deleteArmed={deleteArmed}
      />
      {savedToast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <p
            role="status"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 text-sm font-medium text-emerald-700 shadow-lg dark:text-emerald-300"
          >
            <CheckIcon />
            {savedToast}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EditRow({
  label,
  value,
  onChange,
  onSuggest,
  suggesting,
  disabled,
  maxLength,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSuggest: () => void;
  suggesting: boolean;
  disabled: boolean;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-40 sm:shrink-0 sm:pt-2">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <div className="relative">
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              maxLength={maxLength}
              placeholder={placeholder}
              rows={4}
              className="block w-full rounded-lg border border-border bg-background py-2 pl-3 pr-10 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              maxLength={maxLength}
              placeholder={placeholder}
              className="block w-full rounded-lg border border-border bg-background py-2 pl-3 pr-10 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          )}
          <WriteForMeIconButton
            onClick={onSuggest}
            busy={suggesting}
            disabled={disabled}
            className={multiline ? "absolute right-2 top-2" : "absolute right-2 top-1/2 -translate-y-1/2"}
          />
        </div>
      </dd>
    </div>
  );
}

function WriteForMeIconButton({
  onClick,
  busy,
  disabled,
  className = "",
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title="Write for me"
      aria-label="Write for me"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {busy ? <SpinnerDot /> : <SparkleIcon />}
    </button>
  );
}

function SpinnerDot() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="40 60" />
    </svg>
  );
}

function ConnectionsFooter({
  editOpen,
  showEdit,
  submitting,
  onEdit,
  onCancel,
  onSave,
  onRequestDelete,
  deleteArmed,
}: {
  editOpen: boolean;
  showEdit: boolean;
  submitting: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRequestDelete: () => void;
  deleteArmed: boolean;
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const announce = (label: string) => setToast(`${label} — coming soon`);

  return (
    <footer className="border-t border-border/60">
      {!editOpen ? (
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-3 sm:px-5">
          <div className="flex items-center gap-2 sm:flex-none">
            <p className="inline-flex h-9 items-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connections
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:overflow-x-auto">
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
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-muted/50 sm:ml-auto sm:h-9 sm:w-auto sm:shrink-0 sm:text-xs dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <PenIcon />
              Edit
            </button>
          ) : null}
        </div>
      ) : null}
      {editOpen ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 bg-muted/20 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onRequestDelete}
            disabled={submitting || deleteArmed}
            className="inline-flex h-9 items-center rounded-full px-3 text-xs font-semibold text-rose-600 transition-colors hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
          >
            Delete this agent
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-xs font-semibold text-background shadow-sm transition-transform duration-150 hover:bg-foreground/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save & sync"}
            </button>
          </div>
        </div>
      ) : null}
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

function DeleteAgentConfirm({
  displayName,
  disabled,
  onCancel,
  onDeleted,
}: {
  displayName: string;
  disabled: boolean;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [wipeWorkspace, setWipeWorkspace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmText.trim().toUpperCase() === "DELETE";

  async function doDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/personal-agents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wipeWorkspace }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        problems?: string[];
        error?: string;
      };
      if (!res.ok || !body.ok) {
        const msg = body.problems?.join("; ") || body.error || `Failed (${res.status})`;
        setError(msg);
        return;
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
          Delete {displayName}
        </h3>
        <p className="text-xs text-rose-700/80 dark:text-rose-300/80">
          Removes the Slack app, the running pod, and the per-agent secret. You can create a new agent right after.
          Type <strong className="font-semibold">DELETE</strong> to confirm.
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="block w-full rounded-lg border border-rose-500/40 bg-background px-3 py-2 font-mono text-sm uppercase text-foreground shadow-sm focus:border-rose-500/60 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
        />
        <label className="flex items-start gap-2 text-xs text-rose-700/90 dark:text-rose-300/90">
          <input
            type="checkbox"
            checked={wipeWorkspace}
            onChange={(e) => setWipeWorkspace(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-rose-500/40 text-rose-600 focus:ring-rose-500/30"
          />
          <span>
            Also wipe workspace data on disk. A new agent will start with an empty{" "}
            <code className="rounded bg-background/60 px-1 font-mono text-[11px]">/data</code>.
          </span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmText("");
              setError(null);
              onCancel();
            }}
            disabled={submitting || disabled}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium text-rose-700 transition hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:text-rose-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={doDelete}
            disabled={!canSubmit || submitting || disabled}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Deleting..." : "Delete agent"}
          </button>
        </div>
        {error ? (
          <p className="rounded-lg border border-rose-600/30 bg-background px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
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

function SparkleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2zm7 11l.9 3.1L23 17l-3.1.9L19 21l-.9-3.1L15 17l3.1-.9L19 13z" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

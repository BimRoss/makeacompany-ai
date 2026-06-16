"use client";

import { useCallback, useEffect, useState } from "react";

import { MePersonalAgentIconPicker, type IconPickerValue } from "@/components/me/me-personal-agent-icon-picker";

type Props = {
  agentId: string;
  initialName: string;
  initialDescription: string;
  initialLongDescription: string;
  initialSystemPrompt: string;
  liveSlackIconUrl: string | null;
  ownerName: string;
  ownerSlackUserId: string;
  onCancel: () => void;
  onSaved: (
    name: string,
    description: string,
    longDescription: string,
    systemPrompt: string,
  ) => void;
  onIconPushed: () => void;
  onDeleted: () => void;
};

type Field = "name" | "description" | "longDescription" | "systemPrompt";

function lastIconStorageKey(agentId: string): string {
  return `mac.pa.icon.${agentId}`;
}

export function MePersonalAgentEditForm({
  agentId,
  initialName,
  initialDescription,
  initialLongDescription,
  initialSystemPrompt,
  liveSlackIconUrl,
  ownerName,
  ownerSlackUserId,
  onCancel,
  onSaved,
  onIconPushed,
  onDeleted,
}: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [longDescription, setLongDescription] = useState(initialLongDescription);
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState<Field | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  // Reset to fresh prop values whenever the parent toggles edit mode back on.
  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
    setLongDescription(initialLongDescription);
    setSystemPrompt(initialSystemPrompt);
    setFeedback(null);
  }, [initialName, initialDescription, initialLongDescription, initialSystemPrompt]);

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      onSaved(
        body.displayName ?? name.trim(),
        body.description ?? description.trim(),
        longDescription.trim(),
        body.systemPrompt ?? systemPrompt.trim(),
      );
    } catch (err) {
      setFeedback({ kind: "err", message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <FormField
        label="Name"
        suggesting={suggesting === "name"}
        onSuggest={() => suggest("name")}
        disabled={submitting}
      >
        <input
          type="text"
          required
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </FormField>

      <FormField
        label="Short description"
        hint="One line — appears in Slack app listings."
        suggesting={suggesting === "description"}
        onSuggest={() => suggest("description")}
        disabled={submitting}
      >
        <input
          type="text"
          required
          maxLength={140}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </FormField>

      <FormField
        label="Long description"
        hint="2-3 sentences for the Slack app detail page (175+ chars)."
        suggesting={suggesting === "longDescription"}
        onSuggest={() => suggest("longDescription")}
        disabled={submitting}
      >
        <textarea
          rows={4}
          maxLength={500}
          value={longDescription}
          onChange={(e) => setLongDescription(e.target.value)}
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </FormField>

      <FormField
        label="Agent personality (system prompt)"
        hint="Defines how your agent behaves in Slack. Saved takes effect on the next message."
        suggesting={suggesting === "systemPrompt"}
        onSuggest={() => suggest("systemPrompt")}
        disabled={submitting}
      >
        <textarea
          rows={6}
          maxLength={2000}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={`Add a personality here so your agent has a voice. e.g. "You are ${
            firstWord(ownerName) || "the owner"
          }'s no-nonsense engineering buddy. Reply in 1-2 lines. Always show your sources." — leave blank to keep the default blank-slate behavior.`}
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </FormField>

      <ChangeIconBlock
        agentId={agentId}
        displayName={name}
        description={description}
        liveSlackIconUrl={liveSlackIconUrl}
        disabled={submitting}
        onPushed={onIconPushed}
      />

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

      <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save & sync to Slack"}
        </button>
      </div>

      <DeleteAgentInline
        displayName={initialName || "your agent"}
        disabled={submitting}
        onDeleted={onDeleted}
      />
    </form>
  );
}

function FormField({
  label,
  hint,
  suggesting,
  disabled,
  onSuggest,
  children,
}: {
  label: string;
  hint?: string;
  suggesting: boolean;
  disabled: boolean;
  onSuggest: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
        <button
          type="button"
          onClick={onSuggest}
          disabled={disabled || suggesting}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkleIcon />
          {suggesting ? "Writing..." : "Write for me"}
        </button>
      </div>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ChangeIconBlock({
  agentId,
  displayName,
  description,
  liveSlackIconUrl,
  disabled,
  onPushed,
}: {
  agentId: string;
  displayName: string;
  description: string;
  liveSlackIconUrl: string | null;
  disabled: boolean;
  onPushed: () => void;
}) {
  const [icon, setIcon] = useState<IconPickerValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  // Hydrate the last-pushed icon from localStorage so refresh keeps preview.
  useEffect(() => {
    if (!agentId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(lastIconStorageKey(agentId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as IconPickerValue | null;
      if (parsed?.base64 && parsed.mimeType) setIcon(parsed);
    } catch {
      /* corrupt entry — ignore */
    }
  }, [agentId]);

  const cacheIcon = useCallback(
    (next: IconPickerValue | null) => {
      if (!agentId || typeof window === "undefined") return;
      try {
        if (next) window.localStorage.setItem(lastIconStorageKey(agentId), JSON.stringify(next));
        else window.localStorage.removeItem(lastIconStorageKey(agentId));
      } catch {
        /* quota / privacy mode */
      }
    },
    [agentId],
  );

  const onIconChange = useCallback(
    (next: IconPickerValue | null) => {
      setIcon(next);
      if (next === null) cacheIcon(null);
    },
    [cacheIcon],
  );

  const stagedDataUrl = icon ? `data:${icon.mimeType};base64,${icon.base64}` : null;
  const preview = stagedDataUrl ?? liveSlackIconUrl;

  async function pushIcon() {
    if (!icon) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/me/personal-agents/icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iconBase64: icon.base64, iconMimeType: icon.mimeType }),
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
      const persisted: IconPickerValue | null =
        body.imageBase64 && body.mimeType ? { base64: body.imageBase64, mimeType: body.mimeType } : icon;
      if (persisted) {
        setIcon(persisted);
        cacheIcon(persisted);
      }
      onPushed();
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
        disabled={disabled || submitting}
        displayName={displayName}
        description={description}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={pushIcon}
          disabled={disabled || submitting || !icon}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save icon"}
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

function DeleteAgentInline({
  displayName,
  disabled,
  onDeleted,
}: {
  displayName: string;
  disabled: boolean;
  onDeleted: () => void;
}) {
  const [armed, setArmed] = useState(false);
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

  if (!armed) {
    return (
      <div className="border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={() => setArmed(true)}
          disabled={disabled}
          className="text-xs font-semibold text-rose-600 transition hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
        >
          Delete this agent
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
      <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Delete {displayName}</h3>
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
          Also wipe workspace data on disk. A new agent will start with an empty <code className="rounded bg-background/60 px-1 font-mono text-[11px]">/data</code>.
        </span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            setConfirmText("");
            setError(null);
          }}
          disabled={submitting}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium text-rose-700 transition hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:text-rose-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={doDelete}
          disabled={!canSubmit || submitting}
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
  );
}

function firstWord(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2zm7 11l.9 3.1L23 17l-3.1.9L19 21l-.9-3.1L15 17l3.1-.9L19 13z" />
    </svg>
  );
}

export function PenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

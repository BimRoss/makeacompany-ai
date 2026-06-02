"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

// Personal-agents portal panel (issue #183 / #186 PR5). All network
// calls go through Next.js proxy routes under /api/portal/agents/* so
// the portal session cookie translates to a backend bearer; never call
// the Go backend directly from the browser.
//
// State machine is intentionally simple:
//   loading → ready (with list) → mutating (during create/delete/paste)
//                → ready again
//   loading → unavailable (when portal session is missing or the
//                personal-agents flag is off — backend returns 401/404)

type Agent = {
  slug: string;
  ownerUserId: string;
  displayName: string;
  agentSlackBotUserId?: string;
  googleEmail?: string;
  googleConnected: boolean;
  createdAt: string;
};

type Listed = { agents: Agent[] };

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; agents: Agent[] };

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(trimmed) as { error?: string; detail?: string };
    return parsed.detail ?? parsed.error ?? trimmed.slice(0, 200);
  } catch {
    return trimmed.slice(0, 200);
  }
}

export function PersonalAgentsPanel() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/portal/agents", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) {
        // No portal session — bounce to /me/login. The auth callback
        // drops us back at /me/agents after sign-in (#199).
        window.location.href = "/me/login";
        return;
      }
      if (res.status === 404) {
        setState({ kind: "unavailable", reason: "personal agents are not enabled in this workspace yet" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "unavailable", reason: await readError(res) });
        return;
      }
      const data = (await res.json()) as Listed;
      setState({ kind: "ready", agents: data.agents ?? [] });
    } catch (err) {
      setState({
        kind: "unavailable",
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/portal/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "include",
      });
      if (!res.ok) {
        setCreateError(await readError(res));
        return;
      }
      setName("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(slug: string) {
    if (!confirm(`Delete ${slug}? This removes the agent record and its stored Slack credentials.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/portal/agents/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        alert(`Delete failed: ${await readError(res)}`);
        return;
      }
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-card/80 p-6 text-left shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Personal agents
          </h2>
          <p className="text-xs text-muted-foreground">
            Slack agents that respond only to you. Owned by your Slack identity.
          </p>
        </div>
      </div>

      <form onSubmit={onCreate} className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Agent name (e.g. Bart)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          disabled={creating || state.kind !== "ready"}
          maxLength={80}
        />
        <button
          type="submit"
          disabled={creating || !name.trim() || state.kind !== "ready"}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create
        </button>
      </form>
      {createError ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{createError}</span>
        </div>
      ) : null}

      <div className="mt-5">
        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading…</span>
          </div>
        ) : state.kind === "unavailable" ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>{state.reason}</span>
          </div>
        ) : state.agents.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No personal agents yet. Pick a name above and create one.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {state.agents.map((agent) => (
              <li key={agent.slug} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{agent.displayName}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {agent.slug}
                    </code>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>
                      Slack:{" "}
                      {agent.agentSlackBotUserId ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          <Check className="-mt-0.5 inline h-3 w-3" /> {agent.agentSlackBotUserId}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">not connected</span>
                      )}
                    </span>
                    <span>
                      Google:{" "}
                      {agent.googleConnected ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          <Check className="-mt-0.5 inline h-3 w-3" /> {agent.googleEmail}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">not connected</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SlackTokenPasteButton slug={agent.slug} onSaved={load} />
                  <a
                    href={`/api/portal/agents/${encodeURIComponent(agent.slug)}/connect/start`}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {agent.googleConnected ? "Reconnect Google" : "Connect Google"}
                  </a>
                  <button
                    type="button"
                    onClick={() => onDelete(agent.slug)}
                    aria-label={`Delete ${agent.slug}`}
                    className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SlackTokenPasteButton({ slug, onSaved }: { slug: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [botUserId, setBotUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/agents/${encodeURIComponent(slug)}/slack-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_token: botToken,
          app_token: appToken,
          bot_user_id: botUserId,
        }),
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      setOpen(false);
      setBotToken("");
      setAppToken("");
      setBotUserId("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
      >
        Paste Slack tokens
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="w-full sm:w-auto sm:min-w-[280px] space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <input
        type="password"
        placeholder="xoxb-… (bot token)"
        value={botToken}
        onChange={(e) => setBotToken(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
        disabled={saving}
      />
      <input
        type="password"
        placeholder="xapp-… (app token)"
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
        disabled={saving}
      />
      <input
        type="text"
        placeholder="U… (bot user id)"
        value={botUserId}
        onChange={(e) => setBotUserId(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
        disabled={saving}
      />
      {error ? (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">{error}</div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !botToken || !appToken || !botUserId}
          className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "bimross_orchestrator_debug_token";

export type DecisionEntry = {
  time: string;
  inner_type: string;
  channel_id: string;
  thread_ts: string;
  message_ts: string;
  user_id: string;
  text_preview: string;
  decision: {
    trigger: string;
    employees: string[];
    kind: string;
    tool_id?: string;
  };
  dispatch_note?: string;
  dispatch_results?: Array<{
    employee: string;
    ok: boolean;
    http_status?: number;
    error?: string;
  }>;
};

type Payload = {
  schema_version: number;
  entries: DecisionEntry[];
};

export function OrchestratorDebugPanel() {
  const [token, setToken] = useState("");
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const t = sessionStorage.getItem(STORAGE_KEY);
    if (t) {
      setToken(t);
    }
  }, []);

  const persistToken = useCallback(() => {
    const t = token.trim();
    if (t) {
      sessionStorage.setItem(STORAGE_KEY, t);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [token]);

  const fetchDecisions = useCallback(async () => {
    const t = token.trim();
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (t) {
        headers.Authorization = `Bearer ${t}`;
      }
      const res = await fetch("/api/orchestrator-decisions?limit=100", {
        headers,
        cache: "no-store",
      });
      const body = (await res.json()) as Payload & { error?: string; message?: string };
      if (res.status === 401) {
        setError("Unauthorized — paste the debug token (or enable ORCHESTRATOR_DEBUG_ALLOW_ANON on server).");
        setEntries([]);
        return;
      }
      if (!res.ok) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(body.entries) ? body.entries : []);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchDecisions();
    const id = setInterval(() => void fetchDecisions(), 2500);
    return () => clearInterval(id);
  }, [fetchDecisions]);

  const newestFirst = [...entries].reverse();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="font-[family-name:var(--font-syne)] text-2xl font-bold tracking-tight text-[var(--foreground)] md:text-3xl">
          Slack orchestrator
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Live routing decisions from <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-xs">slack-orchestrator</code>{" "}
          (trigger, squad targets, dispatch). With <code className="text-xs">ORCHESTRATOR_DEBUG_ALLOW_ANON=true</code> no token
          is required; otherwise use the same bearer as <code className="text-xs">ORCHESTRATOR_DEBUG_TOKEN</code> on the orchestrator.
        </p>
      </header>

      <section className="mb-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4">
        <label className="block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Debug token
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token"
            className="min-h-11 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none ring-[var(--ring)] focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                persistToken();
                void fetchDecisions();
              }}
              className="rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
            >
              Save token &amp; refresh
            </button>
            <button
              type="button"
              onClick={() => {
                setToken("");
                sessionStorage.removeItem(STORAGE_KEY);
                setEntries([]);
              }}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              Clear
            </button>
          </div>
        </div>
        {lastFetch ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Last updated: {lastFetch.toLocaleTimeString()}
            {loading ? " · loading…" : ""}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-4 font-[family-name:var(--font-syne)] text-lg font-semibold text-[var(--foreground)]">
          Decisions ({newestFirst.length})
        </h2>
        {newestFirst.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No entries yet. Post in Slack or trigger an app mention; rows appear after the orchestrator processes events.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {newestFirst.map((e, i) => (
              <li
                key={`${e.time}-${e.message_ts}-${i}`}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2 text-xs text-[var(--muted-foreground)]">
                  <span className="font-mono">{new Date(e.time).toLocaleString()}</span>
                  <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[var(--foreground)]">{e.inner_type}</span>
                  <span>
                    trigger <strong className="text-[var(--foreground)]">{e.decision.trigger}</strong>
                  </span>
                  <span>
                    kind <strong className="text-[var(--foreground)]">{e.decision.kind}</strong>
                  </span>
                  {e.decision.tool_id ? (
                    <span>
                      tool <code className="text-[var(--foreground)]">{e.decision.tool_id}</code>
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[var(--foreground)]">
                  <span className="text-[var(--muted-foreground)]">→ </span>
                  {(e.decision.employees ?? []).join(", ") || "—"}
                </p>
                {e.dispatch_note ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Note: {e.dispatch_note}</p>
                ) : null}
                {e.dispatch_results && e.dispatch_results.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-xs">
                    {e.dispatch_results.map((r) => (
                      <li key={r.employee} className="font-mono">
                        <span className={r.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                          {r.ok ? "ok" : "fail"}
                        </span>{" "}
                        {r.employee}
                        {r.http_status ? ` HTTP ${r.http_status}` : ""}
                        {r.error ? ` — ${r.error}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 line-clamp-4 text-xs text-[var(--muted-foreground)]">
                  <span className="select-all">{e.text_preview || "—"}</span>
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)] opacity-80">
                  ch {e.channel_id} · ts {e.message_ts}
                  {e.thread_ts ? ` · thread ${e.thread_ts}` : ""} · user {e.user_id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

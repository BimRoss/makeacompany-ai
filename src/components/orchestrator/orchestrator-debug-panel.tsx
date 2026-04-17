"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

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
    dispatch_mode?: string;
    primary_employee?: string;
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
  schema_version?: number;
  entries: DecisionEntry[];
};

function rowKey(e: DecisionEntry, i: number) {
  return `${e.time}-${e.message_ts}-${i}`;
}

function dispatchSummary(e: DecisionEntry) {
  const mode = e.decision.dispatch_mode?.trim() || "—";
  const primary = e.decision.primary_employee?.trim();
  const n = e.dispatch_results?.length ?? e.decision.employees?.length ?? 0;
  const target = primary ? `${primary} (${mode})` : mode;
  return { target, publishCount: n };
}

export function OrchestratorDebugPanel() {
  const [token, setToken] = useState("");
  const [entries, setEntries] = useState<DecisionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
      setSchemaVersion(typeof body.schema_version === "number" ? body.schema_version : null);
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

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">Routing decisions</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Live log from <code className="rounded bg-muted px-1 py-0.5 text-xs">slack-orchestrator</code> (schema{" "}
          {schemaVersion ?? "—"}). With <code className="text-xs">ORCHESTRATOR_DEBUG_ALLOW_ANON=true</code> no token is
          required; otherwise use the same bearer as <code className="text-xs">ORCHESTRATOR_DEBUG_TOKEN</code>.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Debug token</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token"
            className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-ring focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                persistToken();
                void fetchDecisions();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
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
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
            >
              Clear
            </button>
          </div>
        </div>
        {lastFetch ? (
          <p className="mt-3 text-xs text-muted-foreground">
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
        <h3 className="mb-3 font-display text-lg font-semibold text-foreground">Decision table ({newestFirst.length})</h3>
        {newestFirst.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No entries yet. Post in Slack or trigger an app mention; rows appear after the orchestrator processes events.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-2 py-2" aria-label="Expand" />
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Trigger</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Target / dispatch</th>
                  <th className="px-3 py-2">Publish</th>
                </tr>
              </thead>
              <tbody>
                {newestFirst.map((e, i) => {
                  const k = rowKey(e, i);
                  const open = Boolean(expanded[k]);
                  const { target, publishCount } = dispatchSummary(e);
                  return (
                    <Fragment key={k}>
                      <tr
                        className="cursor-pointer border-b border-border/80 bg-card hover:bg-muted/30"
                        onClick={() => toggle(k)}
                      >
                        <td className="px-2 py-2 text-center text-muted-foreground" aria-hidden>
                          {open ? "▼" : "▶"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                          {new Date(e.time).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.inner_type}</span>
                        </td>
                        <td className="px-3 py-2 font-medium">{e.decision.trigger}</td>
                        <td className="px-3 py-2">{e.decision.kind}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-xs" title={target}>
                          {target}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{publishCount}</td>
                      </tr>
                      {open ? (
                        <tr key={`${k}-detail`} className="border-b border-border bg-muted/20">
                          <td colSpan={7} className="px-4 py-4 text-xs leading-relaxed">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="font-medium text-foreground">Employees</p>
                                <p className="mt-1 font-mono text-muted-foreground">
                                  {(e.decision.employees ?? []).join(", ") || "—"}
                                </p>
                                {e.decision.tool_id ? (
                                  <p className="mt-2">
                                    <span className="text-muted-foreground">tool_id</span>{" "}
                                    <code className="rounded bg-muted px-1">{e.decision.tool_id}</code>
                                  </p>
                                ) : null}
                                {e.dispatch_note ? (
                                  <p className="mt-2 text-amber-800 dark:text-amber-200">Note: {e.dispatch_note}</p>
                                ) : null}
                              </div>
                              <div>
                                <p className="font-medium text-foreground">Slack ids</p>
                                <p className="mt-1 break-all text-muted-foreground">
                                  channel {e.channel_id} · msg {e.message_ts}
                                  {e.thread_ts ? ` · thread ${e.thread_ts}` : ""} · user {e.user_id}
                                </p>
                              </div>
                            </div>
                            {e.dispatch_results && e.dispatch_results.length > 0 ? (
                              <ul className="mt-3 space-y-1 border-t border-border/80 pt-3">
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
                            <p className="mt-3 border-t border-border/80 pt-3 text-muted-foreground">
                              <span className="select-all">{e.text_preview || "—"}</span>
                            </p>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground">Raw JSON</summary>
                              <pre className="mt-2 max-h-48 overflow-auto rounded border border-border bg-background p-2 text-[10px] leading-snug">
                                {JSON.stringify(e, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

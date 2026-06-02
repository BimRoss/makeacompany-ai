"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AgentState = "live" | "down" | "starting" | "unhealthy";

type AgentStatus = {
  name: string;
  state: AgentState;
  replicas: number;
  ready: number;
  reason?: string;
  updatedAt: string;
};

type StatusResponse = {
  agents?: AgentStatus[];
  error?: string;
};

type ToggleResponse = {
  agent?: AgentStatus;
  error?: string;
};

const POLL_MS = 5000;

const STATE_DOT: Record<AgentState, string> = {
  live: "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
  down: "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.18)]",
  starting: "bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.18)]",
  unhealthy: "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.18)]",
};

const STATE_LABEL: Record<AgentState, string> = {
  live: "Live",
  down: "Down",
  starting: "Starting",
  unhealthy: "Unhealthy",
};

function displayName(name: string): string {
  return name.length === 0 ? name : name[0].toUpperCase() + name.slice(1);
}

export function AdminAgentKillSwitch() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/agents/status", { cache: "no-store", signal });
      const body = (await res.json()) as StatusResponse;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setAgents(body.agents ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    fetchStatus(ctl.signal);
    pollingRef.current = setInterval(() => fetchStatus(), POLL_MS);
    return () => {
      ctl.abort();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchStatus]);

  const doToggle = useCallback(
    async (name: string) => {
      setBusy((b) => ({ ...b, [name]: true }));
      // Optimistic flip — gives the toggle a live feel before the round-trip
      setAgents((prev) =>
        prev
          ? prev.map((a) =>
              a.name === name
                ? { ...a, state: a.state === "live" ? "down" : "starting", replicas: a.state === "live" ? 0 : 1 }
                : a,
            )
          : prev,
      );
      try {
        const res = await fetch(`/api/admin/agents/${encodeURIComponent(name)}/toggle`, {
          method: "POST",
          cache: "no-store",
        });
        const body = (await res.json()) as ToggleResponse;
        if (!res.ok || !body.agent) {
          setError(body.error ?? `HTTP ${res.status}`);
          await fetchStatus();
          return;
        }
        setAgents((prev) =>
          prev ? prev.map((a) => (a.name === body.agent!.name ? body.agent! : a)) : [body.agent!],
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "toggle failed");
        await fetchStatus();
      } finally {
        setBusy((b) => ({ ...b, [name]: false }));
      }
    },
    [fetchStatus],
  );

  const handleClick = useCallback(
    (a: AgentStatus) => {
      if (busy[a.name]) return;
      if (a.state === "live" || a.state === "starting" || a.state === "unhealthy") {
        // Off-flip is destructive enough to confirm.
        setConfirmTarget(a.name);
        return;
      }
      void doToggle(a.name);
    },
    [busy, doToggle],
  );

  const confirmingAgent = confirmTarget ? (agents ?? []).find((a) => a.name === confirmTarget) : null;

  return (
    <section className="space-y-3" aria-labelledby="admin-agent-killswitch-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="admin-agent-killswitch-heading"
          className="font-display text-xl font-semibold tracking-tight text-foreground"
        >
          Agent kill switches
        </h2>
        <p className="text-xs text-muted-foreground">
          Scales the prod Deployment between 0 and 1 — reversible in ~10s.
        </p>
      </div>
      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(agents ?? [
          { name: "ross", state: "starting" as AgentState, replicas: 0, ready: 0, updatedAt: "" },
          { name: "joanne", state: "starting" as AgentState, replicas: 0, ready: 0, updatedAt: "" },
        ]).map((a) => {
          const live = a.state === "live";
          const isBusy = !!busy[a.name];
          return (
            <div
              key={a.name}
              className="rounded-xl border border-border bg-background p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`inline-block h-3 w-3 rounded-full ${STATE_DOT[a.state]} ${live ? "animate-pulse" : ""}`}
                  />
                  <div>
                    <div className="font-display text-lg font-semibold text-foreground">{displayName(a.name)}</div>
                    <div className="text-xs text-muted-foreground">
                      {STATE_LABEL[a.state]} · replicas {a.replicas}/{a.ready} ready
                      {a.reason ? ` · ${a.reason}` : ""}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  onClick={() => handleClick(a)}
                  disabled={isBusy || !agents}
                  aria-checked={live}
                  className={[
                    "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-60",
                    live ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700",
                  ].join(" ")}
                  aria-label={`Toggle ${a.name}`}
                >
                  <span
                    className={[
                      "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                      live ? "translate-x-5" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmingAgent ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-killswitch-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
            <h3 id="admin-killswitch-confirm-title" className="font-display text-lg font-semibold text-foreground">
              Kill {displayName(confirmingAgent.name)}?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {displayName(confirmingAgent.name)} will stop responding in Slack within ~10 seconds.
              Toggle back on anytime — no state is lost.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
                onClick={() => setConfirmTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700"
                onClick={() => {
                  const name = confirmingAgent.name;
                  setConfirmTarget(null);
                  void doToggle(name);
                }}
              >
                Kill
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

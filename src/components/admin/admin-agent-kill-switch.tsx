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

// Flat dot (no shadow halo) for the compact sticky strip.
const STATE_DOT_FLAT: Record<AgentState, string> = {
  live: "bg-emerald-500",
  down: "bg-rose-500",
  starting: "bg-amber-400",
  unhealthy: "bg-rose-500",
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

function useKillSwitchState() {
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

  return { agents, error, busy, confirmingAgent, setConfirmTarget, handleClick, doToggle };
}

function ConfirmDialog({
  agent,
  onCancel,
  onConfirm,
}: {
  agent: AgentStatus;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-killswitch-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
        <h3 id="admin-killswitch-confirm-title" className="font-display text-lg font-semibold text-foreground">
          Kill {displayName(agent.name)}?
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {displayName(agent.name)} will stop responding in Slack within ~10 seconds.
          Toggle back on anytime — no state is lost.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700"
            onClick={onConfirm}
          >
            Kill
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminAgentKillSwitch() {
  const { agents, error, busy, confirmingAgent, setConfirmTarget, handleClick, doToggle } =
    useKillSwitchState();

  return (
    <section className="space-y-3" aria-labelledby="admin-agent-killswitch-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="admin-agent-killswitch-heading"
          className="font-display text-xl font-semibold tracking-tight text-foreground"
        >
          Agent kill switches
        </h2>
        <p className="hidden text-xs text-muted-foreground sm:block">
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
              className="rounded-xl border border-border bg-background px-3 py-2 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    aria-hidden
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[a.state]} ${live ? "animate-pulse" : ""}`}
                  />
                  <span className="font-display text-base font-semibold text-foreground">{displayName(a.name)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {STATE_LABEL[a.state]} · {a.replicas}/{a.ready}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  onClick={() => handleClick(a)}
                  disabled={isBusy || !agents}
                  aria-checked={live}
                  className={[
                    "inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-60",
                    live ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700",
                  ].join(" ")}
                  aria-label={`Toggle ${a.name}`}
                >
                  <span
                    className={[
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      live ? "translate-x-4" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmingAgent ? (
        <ConfirmDialog
          agent={confirmingAgent}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            const name = confirmingAgent.name;
            setConfirmTarget(null);
            void doToggle(name);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Compact strip for the sticky observability header — keeps the toggles
 * one click away while scrolling. Polls independently of the full section
 * (cheap K8s read); both share the same confirm-on-off-flip behavior.
 */
export function AdminAgentKillSwitchCompact() {
  const { agents, error, busy, confirmingAgent, setConfirmTarget, handleClick, doToggle } =
    useKillSwitchState();

  const list = agents ?? [
    { name: "joanne", state: "starting" as AgentState, replicas: 0, ready: 0, updatedAt: "" },
    { name: "ross", state: "starting" as AgentState, replicas: 0, ready: 0, updatedAt: "" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Agent kill switches (compact)">
      {list.map((a) => {
        const live = a.state === "live";
        const isBusy = !!busy[a.name];
        return (
          <button
            key={a.name}
            type="button"
            role="switch"
            aria-checked={live}
            disabled={isBusy || !agents}
            onClick={() => handleClick(a)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60",
              live
                ? "border-emerald-500/40 bg-emerald-500/10 text-foreground hover:bg-emerald-500/15"
                : "border-rose-500/40 bg-rose-500/10 text-foreground hover:bg-rose-500/15",
            ].join(" ")}
            title={
              error
                ? `error: ${error}`
                : `${displayName(a.name)} · ${STATE_LABEL[a.state]} · ${a.replicas}/${a.ready} ready`
            }
          >
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${STATE_DOT_FLAT[a.state]} ${live ? "animate-pulse" : ""}`}
            />
            <span>{displayName(a.name)}</span>
            <span className="text-muted-foreground">{STATE_LABEL[a.state]}</span>
          </button>
        );
      })}

      {confirmingAgent ? (
        <ConfirmDialog
          agent={confirmingAgent}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            const name = confirmingAgent.name;
            setConfirmTarget(null);
            void doToggle(name);
          }}
        />
      ) : null}
    </div>
  );
}

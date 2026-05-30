"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { apiBase } from "@/lib/site";

type Operator = {
  email: string;
  slot: number;
};

type WorkspaceStatus = {
  connected: boolean;
  operators?: Operator[];
};

type Props = {
  channelId: string;
  justConnected: boolean;
  justDisconnected: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; status: WorkspaceStatus };

export function WorkspaceConnectPanel({ channelId, justConnected, justDisconnected }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `${apiBase()}/v1/portal/workspace/status?channelId=${encodeURIComponent(channelId)}`,
          { method: "GET", cache: "no-store", credentials: "include" },
        );
        if (cancelled) return;
        if (res.status === 503 || res.status === 404) {
          setState({ kind: "unavailable" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "unavailable" });
          return;
        }
        const data = (await res.json()) as WorkspaceStatus;
        setState({ kind: "ready", status: data });
      } catch {
        if (!cancelled) setState({ kind: "unavailable" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const connectHref = `/api/portal/workspace/connect/start?channelId=${encodeURIComponent(channelId)}`;

  const operators =
    state.kind === "ready" && state.status.connected ? state.status.operators ?? [] : [];
  const isConnected = state.kind === "ready" && state.status.connected;

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-card/80 p-6 text-left shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ExternalLink className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Google Workspace
          </h2>
          <p className="text-xs text-muted-foreground">
            Let Ross read & draft mail, manage your calendar, and work in Drive on your behalf.
          </p>
        </div>
      </div>

      {justConnected ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-900 dark:text-emerald-300">
          <Check className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>Workspace connected. Ross will pick it up on the next message.</span>
        </div>
      ) : null}

      {justDisconnected ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>Workspace disconnected. Re-connect anytime.</span>
        </div>
      ) : null}

      <div className="mt-5">
        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Checking connection…</span>
          </div>
        ) : state.kind === "unavailable" ? (
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Connect Google Workspace
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : isConnected ? (
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connected operators
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {operators.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  No operator details available.
                </li>
              ) : (
                operators.map((op) => (
                  <li
                    key={`${op.email}-${op.slot}`}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-foreground">{op.email}</span>
                    <span className="text-muted-foreground">slot {op.slot}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={connectHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Connect another operator
                <ExternalLink className="h-3 w-3" />
              </a>
              <form action="/api/portal/workspace/disconnect" method="post">
                <input type="hidden" name="channelId" value={channelId} />
                <button
                  type="submit"
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Disconnect
                </button>
              </form>
            </div>
          </div>
        ) : (
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Connect Google Workspace
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

// Admin aggregate table for personal agents (issue #183 / #186 PR5).
// Read-only by design: owners manage their own agents at /me/agents;
// admin can see the full picture but not mutate. Reuses the same
// /api/admin/* proxy pattern as other admin tables (uses the
// mac_admin_session cookie via backend-proxy-auth).

type Agent = {
  slug: string;
  ownerUserId: string;
  displayName: string;
  agentSlackBotUserId?: string;
  googleEmail?: string;
  googleConnected: boolean;
  createdAt: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready"; agents: Agent[] };

export function PersonalAgentsAdminTable() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/personal-agents", {
          cache: "no-store",
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text();
          setState({
            kind: "error",
            reason: text.trim() || `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as { agents?: Agent[] };
        setState({ kind: "ready", agents: data.agents ?? [] });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            reason: err instanceof Error ? err.message : "unknown error",
          });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading personal agents…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <span>{state.reason}</span>
      </div>
    );
  }
  if (state.agents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No personal agents registered yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Slug</th>
            <th className="px-3 py-2 font-medium">Display name</th>
            <th className="px-3 py-2 font-medium">Owner</th>
            <th className="px-3 py-2 font-medium">Slack bot</th>
            <th className="px-3 py-2 font-medium">Google</th>
            <th className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {state.agents.map((a) => (
            <tr key={a.slug}>
              <td className="px-3 py-2 font-mono text-xs">{a.slug}</td>
              <td className="px-3 py-2">{a.displayName}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{a.ownerUserId}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {a.agentSlackBotUserId ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    <Check className="-mt-0.5 inline h-3 w-3" /> {a.agentSlackBotUserId}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {a.googleConnected ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    <Check className="-mt-0.5 inline h-3 w-3" /> {a.googleEmail}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{a.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

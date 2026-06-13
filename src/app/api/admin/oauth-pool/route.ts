import { NextResponse } from "next/server";

import { hasValidAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

// Fans out to each agent's /admin/oauth-pool endpoint (Ross + Joanne) and
// merges the snapshots so the admin page can render a single table. The
// agent endpoints are cluster-internal Services on :8092; tokens come from
// env (ROSS_ADMIN_TOKEN / JOANNE_ADMIN_TOKEN — already provisioned because
// Ross's /admin/reseed uses the same token).
//
// Falls back to empty agent rows when an upstream is down so the page
// keeps rendering — visibility for the *other* agent shouldn't go dark
// because one endpoint is unreachable.

type SlotSnapshot = {
  slot: string;
  spawns_total: number;
  spawns_in_window: number;
  last_spawn_at?: string;
  rate_limit_errs_total: number;
  last_rate_limit_err_at?: string;
  last_rate_limit_err_excerpt?: string;
};

type AgentSnapshot = {
  window_seconds: number;
  now: string;
  slots: SlotSnapshot[];
};

type AgentResult = {
  agent: string;
  url: string;
  ok: boolean;
  error?: string;
  snapshot?: AgentSnapshot;
};

type AgentTarget = { agent: string; url?: string; token?: string };

const AGENT_TARGETS: AgentTarget[] = [
  {
    agent: "ross",
    url: process.env.ROSS_ADMIN_URL ?? "http://ross.ross.svc:8092",
    token: process.env.ROSS_ADMIN_TOKEN,
  },
  {
    agent: "joanne",
    url: process.env.JOANNE_ADMIN_URL ?? "http://joanne.joanne.svc:8092",
    token: process.env.JOANNE_ADMIN_TOKEN,
  },
];

async function fetchAgent({ agent, url, token }: AgentTarget): Promise<AgentResult> {
  const endpoint = `${(url ?? "").replace(/\/$/, "")}/admin/oauth-pool`;
  if (!url || !token) {
    return { agent, url: endpoint, ok: false, error: "url or token env unset" };
  }
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      // Short timeout — admin page shouldn't hang if an agent pod is down.
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return {
        agent,
        url: endpoint,
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }
    const snapshot = (await response.json()) as AgentSnapshot;
    return { agent, url: endpoint, ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { agent, url: endpoint, ok: false, error: message };
  }
}

export async function GET() {
  const adminOk = await hasValidAdminApiSession();
  if (!adminOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const agents = await Promise.all(AGENT_TARGETS.map(fetchAgent));
  return NextResponse.json(
    { agents, checked_at: new Date().toISOString() },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

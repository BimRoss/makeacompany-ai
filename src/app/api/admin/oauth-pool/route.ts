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
  slot_cap_per_window?: number;
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

// Static agents that share the OAuth pool. Garth is listed here even when
// scaled to 0 so the per-agent legend always shows all three pool consumers
// — when his admin endpoint is unreachable he renders with 0 spawns rather
// than disappearing.
const STATIC_AGENT_TARGETS: AgentTarget[] = [
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
  {
    agent: "garth",
    url: process.env.GARTH_ADMIN_URL ?? "http://garth.personal-agents.svc:8092",
    token: process.env.GARTH_ADMIN_TOKEN,
  },
];

// Discover personal agents from K8s. Each running personal agent pod
// exposes an admin HTTP server on :8092 (same as Ross/Joanne). Pods are
// discovered by querying K8s API for all Pods in personal-agents namespace
// with label app=personal-agent. The pod's IP becomes the target URL.
async function discoverPersonalAgents(): Promise<AgentTarget[]> {
  const kubeApiUrl = process.env.KUBERNETES_SERVICE_HOST;
  const kubeApiPort = process.env.KUBERNETES_SERVICE_PORT;
  const token = process.env.KUBERNETES_SERVICE_ACCOUNT_TOKEN;

  if (!kubeApiUrl || !token) {
    // Not running in-cluster; skip personal agent discovery.
    return [];
  }

  try {
    // Temporarily disable TLS verification for K8s API (self-signed cert in-cluster).
    // This is safe because we're only connecting to the K8s API within the cluster.
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const response = await fetch(
      `https://${kubeApiUrl}:${kubeApiPort}/api/v1/namespaces/personal-agents/pods?labelSelector=app=personal-agent`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    // Restore original setting
    if (originalRejectUnauthorized !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }

    if (!response.ok) {
      console.error(`K8s API error querying personal-agents pods: HTTP ${response.status}`);
      return [];
    }

    const podList = (await response.json()) as {
      items: Array<{ metadata: { name: string }; status?: { podIP?: string } }>;
    };
    const targets: AgentTarget[] = [];
    for (const pod of podList.items) {
      const podIp = pod.status?.podIP;
      const podName = pod.metadata.name;
      if (podIp) {
        // Personal agent pods listen on :8092 cluster-internally.
        // They're deployed without auth tokens (cluster-internal only).
        targets.push({
          agent: podName,
          url: `http://${podIp}:8092`,
          token: "", // Will be overridden in fetchAgent; skip auth header
        });
      }
    }
    return targets;
  } catch (error) {
    console.error("Failed to discover personal agents from K8s", error);
    return [];
  }
}

async function getAgentTargets(): Promise<AgentTarget[]> {
  const staticTargets = STATIC_AGENT_TARGETS;
  const personalTargets = await discoverPersonalAgents();
  return [...staticTargets, ...personalTargets];
}

async function fetchAgent({ agent, url, token }: AgentTarget): Promise<AgentResult> {
  const endpoint = `${(url ?? "").replace(/\/$/, "")}/admin/oauth-pool`;
  if (!url) {
    return { agent, url: endpoint, ok: false, error: "url missing" };
  }
  try {
    // Build headers: include auth token for Ross/Joanne (token present),
    // but skip for personal agents (token empty/undefined, cluster-internal).
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      headers,
      cache: "no-store",
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
  const agentTargets = await getAgentTargets();
  const agents = await Promise.all(agentTargets.map(fetchAgent));
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

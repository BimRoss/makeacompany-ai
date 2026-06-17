import { NextResponse } from "next/server";

import {
  backendProxyAuthHeaders,
  hasValidAdminApiSession,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

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

type AgentTarget = {
  agent: string;
  url?: string;
  token?: string;
  /** Upper-cased Slack user ID — used to match the target against the Slack bot table. */
  slackUserID?: string;
};

type SlackBot = {
  slackUserID: string;
  displayName: string;
};

// Static agents that share the OAuth pool. Ross + Joanne live in their own
// namespaces with admin tokens; every other pool consumer (garth and
// friends) is a personal-agent and gets discovered dynamically below.
const STATIC_AGENT_TARGETS: AgentTarget[] = [
  {
    agent: "ross",
    url: process.env.ROSS_ADMIN_URL ?? "http://ross.ross.svc:8092",
    token: process.env.ROSS_ADMIN_TOKEN,
    slackUserID: (process.env.ROSS_SLACK_BOT_ID ?? "").trim().toUpperCase() || undefined,
  },
  {
    agent: "joanne",
    url: process.env.JOANNE_ADMIN_URL ?? "http://joanne.joanne.svc:8092",
    token: process.env.JOANNE_ADMIN_TOKEN,
    slackUserID: (process.env.JOANNE_SLACK_BOT_ID ?? "").trim().toUpperCase() || undefined,
  },
];

const PERSONAL_AGENT_NAMESPACE = "personal-agents";
const PERSONAL_AGENT_LABEL_SELECTOR = "bimross.com/integration=personal-agent";
const PERSONAL_AGENT_AGENT_ID_LABEL = "bimross.com/agent-id";
const PERSONAL_AGENT_SLACK_USER_ANNO = "bimross.com/slack-user-id";

// Slug → display label for known personal-agent slack identities. Keys are
// slack user IDs sourced from *_SLACK_BOT_ID env vars (same scheme the
// backend uses for `MULTIAGENT_BOT_USER_IDS`). Anything unmapped renders as
// the slack ID or a truncated agent-id hash.
function personalAgentDisplayLabelFromEnv(slackUserID: string): string | null {
  const id = slackUserID.trim().toUpperCase();
  if (!id) return null;
  const envPairs: Array<[string, string]> = [
    [process.env.GARTH_SLACK_BOT_ID ?? "", "garth"],
    [process.env.TIM_SLACK_BOT_ID ?? "", "tim"],
    [process.env.ALEX_SLACK_BOT_ID ?? "", "alex"],
    [process.env.ANNA_SLACK_BOT_ID ?? "", "anna"],
  ];
  for (const [envVal, label] of envPairs) {
    if (envVal.trim().toUpperCase() === id) return label;
  }
  const multi = (process.env.MULTIAGENT_BOT_USER_IDS ?? "").split(",");
  for (const pair of multi) {
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const slug = pair.slice(0, idx).trim().toLowerCase();
    const uid = pair.slice(idx + 1).trim().toUpperCase();
    if (uid === id && slug) return slug;
  }
  return null;
}

// withK8sTLSRelaxed is a tiny helper so each in-cluster fetch can opt into
// skipping verification of the self-signed K8s API cert without leaving the
// process-wide flag flipped after it returns.
async function withK8sTLSRelaxed<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fn();
  } finally {
    if (prev !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}

// Discover personal agents from K8s. Each running personal-agent pod
// exposes an admin HTTP server on :8092 (same shape as Ross/Joanne). We
// join the pod list with the per-agent runtime Secrets (which carry the
// slack-user-id annotation) so the legend can render "garth" instead of a
// pod-name hash.
async function discoverPersonalAgents(): Promise<AgentTarget[]> {
  const kubeApiUrl = process.env.KUBERNETES_SERVICE_HOST;
  const kubeApiPort = process.env.KUBERNETES_SERVICE_PORT;
  const token = process.env.KUBERNETES_SERVICE_ACCOUNT_TOKEN;

  if (!kubeApiUrl || !token) {
    return [];
  }

  const base = `https://${kubeApiUrl}:${kubeApiPort}/api/v1/namespaces/${PERSONAL_AGENT_NAMESPACE}`;
  const selector = encodeURIComponent(PERSONAL_AGENT_LABEL_SELECTOR);
  const authHeaders = { Authorization: `Bearer ${token}` };

  try {
    return await withK8sTLSRelaxed(async () => {
      const [podsResp, secretsResp] = await Promise.all([
        fetch(`${base}/pods?labelSelector=${selector}`, { headers: authHeaders }),
        fetch(`${base}/secrets?labelSelector=${selector}`, { headers: authHeaders }),
      ]);

      if (!podsResp.ok) {
        console.error(`K8s API error querying personal-agents pods: HTTP ${podsResp.status}`);
        return [];
      }

      const podList = (await podsResp.json()) as {
        items: Array<{
          metadata: { name: string; labels?: Record<string, string> };
          status?: { podIP?: string; phase?: string };
        }>;
      };

      // Build agent-id → slack-user-id from Secret annotations.
      const slackIDByAgentID = new Map<string, string>();
      if (secretsResp.ok) {
        const secretList = (await secretsResp.json()) as {
          items: Array<{
            metadata: {
              labels?: Record<string, string>;
              annotations?: Record<string, string>;
            };
          }>;
        };
        for (const s of secretList.items) {
          const agentID = s.metadata.labels?.[PERSONAL_AGENT_AGENT_ID_LABEL];
          const slackID = s.metadata.annotations?.[PERSONAL_AGENT_SLACK_USER_ANNO];
          if (agentID && slackID) slackIDByAgentID.set(agentID, slackID);
        }
      } else {
        console.warn(`K8s API non-200 querying personal-agents secrets: HTTP ${secretsResp.status}`);
      }

      const targets: AgentTarget[] = [];
      for (const pod of podList.items) {
        const podIp = pod.status?.podIP;
        if (!podIp) continue;
        const agentID = pod.metadata.labels?.[PERSONAL_AGENT_AGENT_ID_LABEL] ?? "";
        const slackID = slackIDByAgentID.get(agentID) ?? "";
        const friendly = slackID ? personalAgentDisplayLabelFromEnv(slackID) : null;
        const label = friendly ?? (slackID || (agentID ? agentID.slice(0, 8) : pod.metadata.name));
        targets.push({
          agent: label,
          url: `http://${podIp}:8092`,
          token: "", // cluster-internal; personal agents skip auth
          slackUserID: slackID ? slackID.toUpperCase() : undefined,
        });
      }
      return targets;
    });
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

// fetchSlackBots pulls the workspace user list from the backend and returns
// the bots-only view (isBot && !isDeleted). The legend uses this as its
// source of truth — `bot: yes` rows in the admin Slack table are the agents
// we want to track in the pool, even when their pod is unreachable. A
// non-2xx is logged (per the fail-open gate-fetcher convention) and treated
// as "Slack table unavailable" so the route can fall back to raw targets.
async function fetchSlackBots(): Promise<SlackBot[] | null> {
  try {
    const backend = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/slack-workspace-users`;
    const response = await fetch(backend, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      console.warn(`oauth-pool: slack-workspace-users non-200: HTTP ${response.status}`);
      return null;
    }
    const body = (await response.json()) as {
      users?: Array<{
        slackUserId?: string;
        isBot?: boolean;
        isDeleted?: boolean;
        realName?: string;
        displayName?: string;
        username?: string;
      }>;
    };
    const bots: SlackBot[] = [];
    for (const u of body.users ?? []) {
      if (!u.isBot || u.isDeleted) continue;
      const id = (u.slackUserId ?? "").trim().toUpperCase();
      if (!id) continue;
      const dn =
        (u.realName ?? "").trim() ||
        (u.displayName ?? "").trim() ||
        (u.username ?? "").trim() ||
        id;
      bots.push({ slackUserID: id, displayName: dn });
    }
    return bots;
  } catch (error) {
    console.warn("oauth-pool: failed to fetch slack-workspace-users", error);
    return null;
  }
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

  const [agentTargets, slackBots] = await Promise.all([
    getAgentTargets(),
    fetchSlackBots(),
  ]);

  // When the Slack table is reachable, treat it as the source of truth:
  // every bot row gets a card (snapshot if its pod is reachable, "down"
  // marker otherwise). When the table is down, render whatever targets we
  // can find — better stale than blank.
  let agents: AgentResult[];
  if (slackBots && slackBots.length > 0) {
    const targetBySlackID = new Map<string, AgentTarget>();
    const unclaimed: AgentTarget[] = [];
    for (const t of agentTargets) {
      if (t.slackUserID && !targetBySlackID.has(t.slackUserID)) {
        targetBySlackID.set(t.slackUserID, t);
      } else {
        unclaimed.push(t);
      }
    }

    const resolved: Array<AgentTarget & { displayName: string }> = [];
    const seenSlackIDs = new Set<string>();
    for (const bot of slackBots) {
      seenSlackIDs.add(bot.slackUserID);
      const match = targetBySlackID.get(bot.slackUserID);
      if (match) {
        resolved.push({ ...match, agent: bot.displayName, displayName: bot.displayName });
      } else {
        resolved.push({
          agent: bot.displayName,
          slackUserID: bot.slackUserID,
          displayName: bot.displayName,
        });
      }
    }
    // Surface targets that have no Slack bot match too, so a running pod
    // doesn't disappear silently if its identity is missing from the table.
    for (const t of unclaimed) {
      if (t.slackUserID && seenSlackIDs.has(t.slackUserID)) continue;
      resolved.push({ ...t, displayName: t.agent });
    }

    agents = await Promise.all(
      resolved.map((t) =>
        t.url
          ? fetchAgent(t)
          : Promise.resolve<AgentResult>({
              agent: t.agent,
              url: "",
              ok: false,
              error: "no pod found for slack bot",
            })
      )
    );
  } else {
    agents = await Promise.all(agentTargets.map(fetchAgent));
  }

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

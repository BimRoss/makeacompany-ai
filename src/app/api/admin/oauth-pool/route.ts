import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import {
  backendProxyAuthHeaders,
  hasValidAdminApiSession,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

async function readServiceAccountToken(): Promise<string | null> {
  try {
    const raw = await readFile(SERVICE_ACCOUNT_TOKEN_PATH, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

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
  /**
   * Personal-agent id (bimross.com/agent-id label). Used to join against the
   * backend personal-agents list so the row can render the agent's real app
   * name ("Jonai") instead of an id hash. Undefined for Ross/Joanne.
   */
  agentID?: string;
  /**
   * Set when the target is known to be unreachable before we even attempt a
   * fetch (e.g. a personal-agent Deployment scaled to 0 with no Pod). The
   * row still renders in the legend so the agent stays visible; fetchAgent
   * short-circuits with this string in `error`.
   */
  preFailReason?: string;
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

// Discover personal agents from K8s. Each personal-agent has a Deployment
// + Service + Secret in the personal-agents namespace, all labeled
// `bimross.com/integration=personal-agent`. We enumerate Deployments (so
// scaled-to-0 agents still render in the legend, with 0 spawns and a
// "scaled to 0" marker) and join with Pods to pick up a pod IP when one
// is running. Secret annotations carry the slack-user-id so the legend
// can render "garth" instead of a resource-name hash.
async function discoverPersonalAgents(): Promise<AgentTarget[]> {
  const kubeApiUrl = process.env.KUBERNETES_SERVICE_HOST;
  const kubeApiPort = process.env.KUBERNETES_SERVICE_PORT;
  // The in-cluster service account token is mounted by kubelet at a
  // well-known path; it is not exposed as an env var.
  const token = await readServiceAccountToken();

  if (!kubeApiUrl || !token) {
    return [];
  }

  const coreBase = `https://${kubeApiUrl}:${kubeApiPort}/api/v1/namespaces/${PERSONAL_AGENT_NAMESPACE}`;
  const appsBase = `https://${kubeApiUrl}:${kubeApiPort}/apis/apps/v1/namespaces/${PERSONAL_AGENT_NAMESPACE}`;
  const selector = encodeURIComponent(PERSONAL_AGENT_LABEL_SELECTOR);
  const authHeaders = { Authorization: `Bearer ${token}` };

  try {
    return await withK8sTLSRelaxed(async () => {
      const [deploysResp, podsResp, secretsResp] = await Promise.all([
        fetch(`${appsBase}/deployments?labelSelector=${selector}`, { headers: authHeaders }),
        fetch(`${coreBase}/pods?labelSelector=${selector}`, { headers: authHeaders }),
        fetch(`${coreBase}/secrets?labelSelector=${selector}`, { headers: authHeaders }),
      ]);

      if (!deploysResp.ok) {
        console.error(
          `K8s API error querying personal-agents deployments: HTTP ${deploysResp.status}`,
        );
        return [];
      }

      const deployList = (await deploysResp.json()) as {
        items: Array<{
          metadata: {
            name: string;
            labels?: Record<string, string>;
            annotations?: Record<string, string>;
          };
        }>;
      };

      // Build resource-name → pod IP. Deployment and its pods share the
      // `app.kubernetes.io/name` label (set in k8s_personal_agent_deployment.go),
      // so that's the join key.
      const podIPByResourceName = new Map<string, string>();
      if (podsResp.ok) {
        const podList = (await podsResp.json()) as {
          items: Array<{
            metadata: { name: string; labels?: Record<string, string> };
            status?: { podIP?: string };
          }>;
        };
        for (const pod of podList.items) {
          const podIp = pod.status?.podIP;
          if (!podIp) continue;
          const rn = pod.metadata.labels?.["app.kubernetes.io/name"];
          if (rn && !podIPByResourceName.has(rn)) podIPByResourceName.set(rn, podIp);
        }
      } else {
        console.warn(
          `K8s API non-200 querying personal-agents pods: HTTP ${podsResp.status}`,
        );
      }

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
        console.warn(
          `K8s API non-200 querying personal-agents secrets: HTTP ${secretsResp.status}`,
        );
      }

      const targets: AgentTarget[] = [];
      for (const dep of deployList.items) {
        const resourceName = dep.metadata.name;
        const agentID = dep.metadata.labels?.[PERSONAL_AGENT_AGENT_ID_LABEL] ?? "";
        // The Slack id on the deployment/secret is the *owner* (a human), not
        // the agent's bot — useful only as a dedup key. The real app name is
        // resolved in GET by joining agentID against the backend personal-agents
        // list (see fetchPersonalAgentNames); this label is just the fallback
        // shown if that lookup misses.
        const ownerSlackID =
          dep.metadata.annotations?.[PERSONAL_AGENT_SLACK_USER_ANNO] ??
          slackIDByAgentID.get(agentID) ??
          "";
        const friendly = ownerSlackID ? personalAgentDisplayLabelFromEnv(ownerSlackID) : null;
        const label = friendly ?? (agentID ? agentID.slice(0, 8) : resourceName);
        const podIp = podIPByResourceName.get(resourceName);
        targets.push({
          agent: label,
          url: podIp ? `http://${podIp}:8092` : undefined,
          token: "", // cluster-internal; personal agents skip auth
          agentID: agentID || undefined,
          slackUserID: ownerSlackID ? ownerSlackID.toUpperCase() : undefined,
          preFailReason: podIp ? undefined : "scaled to 0",
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

// MCP bot users (e.g. "Joanne MCP", "Ross MCP") show up in the workspace
// users.list with isBot=true but do not draw from the CLAUDE_CODE_OAUTH_TOKEN
// pool — they're Slack app integrations for the gws-mcp gateway. Filter
// them out by name so the panel only shows agents that actually consume the
// pool. Case-insensitive word match on "mcp" across displayName/realName/
// username catches "Ross MCP", "joanne-mcp", "mcp-bot", etc.
const MCP_NAME_RE = /\bmcp\b/i;

// fetchSlackBots pulls the workspace user list from the backend and returns
// the bots-only view (isBot && !isDeleted, MCPs filtered out). Used purely
// as a *name enrichment* lookup keyed by Slack user ID — the agent targets
// (Ross/Joanne static + personal agents discovered from K8s) decide *which*
// rows render; the Slack table just supplies friendly display names. A
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
      const realName = (u.realName ?? "").trim();
      const displayName = (u.displayName ?? "").trim();
      const username = (u.username ?? "").trim();
      if (
        MCP_NAME_RE.test(realName) ||
        MCP_NAME_RE.test(displayName) ||
        MCP_NAME_RE.test(username)
      ) {
        continue;
      }
      const dn = realName || displayName || username || id;
      bots.push({ slackUserID: id, displayName: dn });
    }
    return bots;
  } catch (error) {
    console.warn("oauth-pool: failed to fetch slack-workspace-users", error);
    return null;
  }
}

// fetchPersonalAgentNames pulls the backend's personal-agents summary and
// returns agentId → app display name (e.g. "dddad820…" → "Jonai"). This is the
// authoritative source for a PA's app name — K8s only carries the agent id and
// the owner's Slack id, not the name the user chose. Non-2xx is logged (fail-open
// gate-fetcher convention) and treated as "no names", so rows fall back to the
// id hash rather than going blank.
async function fetchPersonalAgentNames(): Promise<Map<string, string>> {
  const byAgentID = new Map<string, string>();
  try {
    const backend = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/personal-agents`;
    const response = await fetch(backend, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      console.warn(`oauth-pool: personal-agents non-200: HTTP ${response.status}`);
      return byAgentID;
    }
    const body = (await response.json()) as {
      agents?: Array<{ agentId?: string; displayName?: string }>;
    };
    for (const a of body.agents ?? []) {
      const id = (a.agentId ?? "").trim();
      const name = (a.displayName ?? "").trim();
      if (id && name) byAgentID.set(id, name);
    }
    return byAgentID;
  } catch (error) {
    console.warn("oauth-pool: failed to fetch personal-agents", error);
    return byAgentID;
  }
}

async function fetchAgent({ agent, url, token, preFailReason }: AgentTarget): Promise<AgentResult> {
  const endpoint = `${(url ?? "").replace(/\/$/, "")}/admin/oauth-pool`;
  if (preFailReason) {
    return { agent, url: endpoint, ok: false, error: preFailReason };
  }
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

  const [agentTargets, slackBots, paNameByAgentID] = await Promise.all([
    getAgentTargets(),
    fetchSlackBots(),
    fetchPersonalAgentNames(),
  ]);

  // Targets are the source of truth for *which* rows to render — only
  // agents that actually draw from the pool (Ross + Joanne static + every
  // discovered personal-agent pod) show up. The Slack workspace bots table
  // is used purely to enrich display names by slackUserID; bots without a
  // matching target are dropped (MCPs in particular — already filtered in
  // fetchSlackBots — and any other workspace integration that doesn't
  // consume the pool). De-duped by slackUserID first, then by URL, so
  // a target that lacks ROSS_SLACK_BOT_ID/JOANNE_SLACK_BOT_ID env wiring
  // can't collide with itself.
  const nameBySlackID = new Map<string, string>();
  if (slackBots) {
    for (const bot of slackBots) nameBySlackID.set(bot.slackUserID, bot.displayName);
  }

  const seenSlackIDs = new Set<string>();
  const seenURLs = new Set<string>();
  const deduped: AgentTarget[] = [];
  for (const t of agentTargets) {
    if (t.slackUserID) {
      if (seenSlackIDs.has(t.slackUserID)) continue;
      seenSlackIDs.add(t.slackUserID);
    }
    if (t.url) {
      if (seenURLs.has(t.url)) continue;
      seenURLs.add(t.url);
    }
    // Prefer the personal-agent's real app name (joined by agentID), then the
    // Slack workspace bot name (Ross/Joanne), then the discovery fallback.
    const displayName =
      (t.agentID && paNameByAgentID.get(t.agentID)) ||
      (t.slackUserID && nameBySlackID.get(t.slackUserID)) ||
      t.agent;
    deduped.push({ ...t, agent: displayName });
  }

  const agents = await Promise.all(deduped.map(fetchAgent));

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

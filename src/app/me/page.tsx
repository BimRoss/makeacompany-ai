import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  MeAgentsGrid,
  type AccountInfo,
  type AgentRecord,
  type CanCreateReason,
} from "@/components/me/me-agents-grid";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

type Billing = {
  hasManageableSubscription?: boolean;
  subscriptionStatus?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number;
};

type MePayload = {
  authenticated?: boolean;
  email?: string;
  slackUserId?: string;
  slackProfileImageUrl?: string;
  slackDisplayName?: string;
  tier?: string;
  freeLifetime?: boolean;
  expiresAt?: string;
  billing?: Billing;
  subscribeUrl?: string;
  canCancel?: boolean;
};

export const dynamic = "force-dynamic";

async function fetchMe(token: string): Promise<MePayload | null> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/auth/me`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json().catch(() => null)) as MePayload | null;
  } catch {
    return null;
  }
}

type AgentsEnvelope = {
  agents: AgentRecord[];
  maxPerUser: number;
  canCreate: boolean;
  canCreateReason: CanCreateReason;
};

const DEFAULT_MAX_PER_USER = 3;

// Reads the multi-agent list envelope (#651). We deliberately ignore the
// legacy hoisted top-level fields the backend still returns for back-compat —
// the UI is driven entirely by agents[] + the gate fields.
async function fetchPersonalAgents(token: string): Promise<AgentsEnvelope> {
  const fallback: AgentsEnvelope = {
    agents: [],
    maxPerUser: DEFAULT_MAX_PER_USER,
    canCreate: false,
    canCreateReason: "",
  };
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/mine`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return fallback;
    }
    const payload = (await res.json().catch(() => null)) as Partial<AgentsEnvelope> | null;
    if (!payload) return fallback;
    return {
      agents: Array.isArray(payload.agents) ? payload.agents : [],
      maxPerUser:
        typeof payload.maxPerUser === "number" && payload.maxPerUser > 0
          ? payload.maxPerUser
          : DEFAULT_MAX_PER_USER,
      canCreate: Boolean(payload.canCreate),
      canCreateReason: (payload.canCreateReason ?? "") as CanCreateReason,
    };
  } catch {
    return fallback;
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function pillValue(v?: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "none" || lower === "n/a") return null;
  return s;
}

function formatRenewDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Flattens the /me payload into the serializable shape the client grid renders
// in the first (Account) tile.
function toAccountInfo(me: MePayload): AccountInfo {
  const email = (me.email ?? "").trim();
  const slackName = (me.slackDisplayName ?? "").trim();
  const billing = me.billing ?? {};
  const periodEndUnix =
    typeof billing.currentPeriodEnd === "number" && billing.currentPeriodEnd > 0
      ? billing.currentPeriodEnd
      : null;
  return {
    email,
    displayName: slackName || displayNameFromEmail(email),
    portraitUrl: (me.slackProfileImageUrl ?? "").trim(),
    slackUserId: me.slackUserId?.trim() ?? "",
    subscriptionStatus: pillValue(billing.subscriptionStatus),
    tier: pillValue(me.tier),
    freeLifetime: Boolean(me.freeLifetime),
    cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
    periodEndLabel: periodEndUnix ? formatRenewDate(periodEndUnix) : null,
    canCancel: Boolean(me.canCancel),
    subscribeUrl: me.subscribeUrl?.trim() ?? "",
  };
}

export default async function MePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";
  if (!token) {
    redirect("/me/login?auth=required");
  }
  const me = await fetchMe(token);
  if (!me?.authenticated || !me.email) {
    redirect("/me/login?auth=required");
  }
  const envelope = await fetchPersonalAgents(token);
  const slackUserIDKnown = Boolean(me.slackUserId?.trim());
  const ownerName =
    (me.slackDisplayName ?? "").trim() || displayNameFromEmail(me.email ?? "");
  const ownerSlackUserId = me.slackUserId?.trim() ?? "";
  const ownerEmail = (me.email ?? "").trim();
  const account = toAccountInfo(me);

  return (
    <div className="mx-auto flex w-full flex-col gap-4 py-8 sm:py-10">
      {/* One grid: [Account] [Agent…] [Add]. The header carries the N/max
          affordance the old section split used to. */}
      <div className="flex items-baseline gap-2 px-1">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Agents
        </h1>
        <span className="text-sm font-medium tabular-nums text-muted-foreground/70">
          · {envelope.agents.length}/{envelope.maxPerUser}
        </span>
      </div>

      <MeAgentsGrid
        account={account}
        agents={envelope.agents}
        maxPerUser={envelope.maxPerUser}
        canCreate={envelope.canCreate}
        canCreateReason={envelope.canCreateReason}
        slackUserIDKnown={slackUserIDKnown}
        ownerName={ownerName}
        ownerSlackUserId={ownerSlackUserId}
        ownerEmail={ownerEmail}
      />
    </div>
  );
}

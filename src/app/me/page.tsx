import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MeCancelSubscriptionButton } from "@/components/me/me-cancel-subscription-button";
import { MePersonalAgentCreationForm } from "@/components/me/me-personal-agent-creation-form";
import { MePersonalAgentStatusPanel } from "@/components/me/me-personal-agent-status-panel";
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

type AgentStatusPayload = {
  hasAgent: boolean;
  agentId?: string;
  displayName?: string;
  description?: string;
  slackAppId?: string;
  status?: string;
  installUrl?: string;
};

async function fetchPersonalAgent(token: string): Promise<AgentStatusPayload> {
  const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/personal-agents/mine`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return { hasAgent: false };
    }
    const payload = (await res.json().catch(() => null)) as AgentStatusPayload | null;
    return payload ?? { hasAgent: false };
  } catch {
    return { hasAgent: false };
  }
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
  const agent = await fetchPersonalAgent(token);
  const slackUserIDKnown = Boolean(me.slackUserId?.trim());
  const ownerName =
    (me.slackDisplayName ?? "").trim() || displayNameFromEmail(me.email ?? "");
  const ownerSlackUserId = me.slackUserId?.trim() ?? "";

  return (
    <div className="mx-auto flex w-full flex-col gap-6 py-8 sm:py-10">
      <ProfileCard me={me} />
      <PersonalAgentCard
        agent={agent}
        slackUserIDKnown={slackUserIDKnown}
        ownerName={ownerName}
        ownerSlackUserId={ownerSlackUserId}
      />
    </div>
  );
}

const PILL_TONES = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;

type PillTone = keyof typeof PILL_TONES;

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: PillTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): PillTone {
  switch (status) {
    case "active":
    case "trialing":
      return "positive";
    case "past_due":
    case "unpaid":
      return "warning";
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return "danger";
    default:
      return "neutral";
  }
}

function formatRenewDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function pillValue(v?: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "none" || lower === "n/a") return null;
  return s;
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function avatarInitial(name: string, email: string): string {
  const seed = name.trim() || email.trim();
  return (seed[0] ?? "?").toUpperCase();
}

function ProfileCard({ me }: { me: MePayload }) {
  const email = me.email ?? "";
  const slackName = (me.slackDisplayName ?? "").trim();
  const displayName = slackName || displayNameFromEmail(email);
  const portraitUrl = (me.slackProfileImageUrl ?? "").trim();
  const billing = me.billing ?? {};
  const status = pillValue(billing.subscriptionStatus);
  const cancelAtEnd = Boolean(billing.cancelAtPeriodEnd);
  const periodEndUnix =
    typeof billing.currentPeriodEnd === "number" && billing.currentPeriodEnd > 0
      ? billing.currentPeriodEnd
      : null;
  const tier = pillValue(me.tier);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-4 sm:gap-4 sm:px-5 sm:py-5">
        <div
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/90 text-xl font-semibold text-background"
        >
          {portraitUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Slack CDN URL, fine to skip next/image optimization
            <img src={portraitUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <span>{avatarInitial(displayName, email)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {displayName}
          </h1>
          <p className="truncate text-sm text-muted-foreground" title={email}>
            {email || "No email"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {status ? <Pill tone={statusTone(status)}>{status}</Pill> : null}
          {tier ? <Pill>{tier}</Pill> : null}
          {me.freeLifetime ? <Pill tone="positive">free lifetime</Pill> : null}
          {cancelAtEnd ? <Pill tone="warning">cancels at period end</Pill> : null}
        </div>
      </header>
      <dl className="divide-y divide-border/60 px-4 py-2 text-sm sm:px-5">
        <Row label="Email" value={email || "No email"} mono />
        <Row label="Slack user ID" value={me.slackUserId?.trim() || "No Slack ID"} mono />
        {periodEndUnix ? (
          <Row label={cancelAtEnd ? "Ends" : "Renews"} value={formatRenewDate(periodEndUnix)} />
        ) : null}
      </dl>
      <BillingActions me={me} />
    </section>
  );
}

function BillingActions({ me }: { me: MePayload }) {
  const billing = me.billing ?? {};
  const hasManageableSubscription = Boolean(billing.hasManageableSubscription);
  const cancelAtEnd = Boolean(billing.cancelAtPeriodEnd);
  const canCancel = Boolean(me.canCancel);
  const subscribeUrl = me.subscribeUrl?.trim() ?? "";

  if (canCancel) {
    return (
      <div className="flex justify-end border-t border-border/60 px-4 py-4 sm:px-5">
        <MeCancelSubscriptionButton />
      </div>
    );
  }
  if (hasManageableSubscription || cancelAtEnd) {
    return null;
  }
  if (!subscribeUrl) {
    return null;
  }
  return (
    <div className="flex justify-end border-t border-border/60 px-5 py-4">
      <a
        href={subscribeUrl}
        className="inline-flex h-10 items-center justify-center rounded-xl border-2 border-foreground/15 bg-background px-5 text-sm font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        Subscribe — $99/mo
      </a>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-3 last:pb-3">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right text-foreground ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function PersonalAgentCard({
  agent,
  slackUserIDKnown,
  ownerName,
  ownerSlackUserId,
}: {
  agent: AgentStatusPayload;
  slackUserIDKnown: boolean;
  ownerName: string;
  ownerSlackUserId: string;
}) {
  // When the user has an installed agent, the status panel owns the full
  // section (avatar + name + rows + edit) so it mirrors the Profile card
  // structure 1:1. No outer wrapper needed.
  if (agent.hasAgent) {
    return (
      <MePersonalAgentStatusPanel
        initial={agent}
        ownerName={ownerName}
        ownerSlackUserId={ownerSlackUserId}
      />
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm ring-1 ring-black/[0.03] sm:p-5 dark:ring-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">Personal agent</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your private Slack-bound AI, gated to your Slack user ID.
          </p>
        </div>
        <Pill>New</Pill>
      </div>
      <div className="mt-4">
        {!slackUserIDKnown ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Your email isn&apos;t in the MakeaCompany Slack workspace yet, so we can&apos;t bind an agent to your Slack
            identity. Join the workspace, then refresh.
          </p>
        ) : (
          <MePersonalAgentCreationForm />
        )}
      </div>
    </section>
  );
}

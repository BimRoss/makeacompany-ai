"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { MeCancelSubscriptionButton } from "@/components/me/me-cancel-subscription-button";
import { MeDetailOverlay } from "@/components/me/me-detail-overlay";
import { MePersonalAgentCreationForm } from "@/components/me/me-personal-agent-creation-form";
import { MePersonalAgentStatusPanel } from "@/components/me/me-personal-agent-status-panel";
import type { YtSource } from "@/components/me/me-personal-agent-youtube-ingest";
import { readCachedAgentIcon } from "@/lib/personal-agent-icon-cache";

// One agent record from the /mine envelope (agents[]). Mirrors the fields the
// status panel consumes; see personalAgentMineView in the backend (#651).
export type AgentRecord = {
  agentId?: string;
  displayName?: string;
  description?: string;
  longDescription?: string;
  systemPrompt?: string;
  youtubeSources?: YtSource[];
  slackAppId?: string;
  status?: string;
  visibility?: string;
  showIntelligence?: boolean;
  teamMode?: boolean;
  installUrl?: string;
};

// canCreateReason values the backend emits (#651). "" means a new agent can be
// created right now.
export type CanCreateReason = "" | "max_reached" | "prior_not_installed" | "no_slack_user_id";

export type AccountInfo = {
  email: string;
  displayName: string;
  portraitUrl: string;
  slackUserId: string;
  subscriptionStatus: string | null;
  tier: string | null;
  freeLifetime: boolean;
  cancelAtPeriodEnd: boolean;
  periodEndLabel: string | null;
  canCancel: boolean;
  subscribeUrl: string;
};

type Props = {
  account: AccountInfo;
  agents: AgentRecord[];
  maxPerUser: number;
  canCreate: boolean;
  canCreateReason: CanCreateReason;
  slackUserIDKnown: boolean;
  ownerName: string;
  ownerSlackUserId: string;
  ownerEmail: string;
};

// What the overlay is currently showing: a specific agent (by agentId), the
// create form, or nothing.
type Overlay = { kind: "agent"; agentId: string } | { kind: "create" } | null;

const PILL_TONES = {
  neutral: "border-border bg-muted/40 text-muted-foreground",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;

type PillTone = keyof typeof PILL_TONES;

const STATUS_TONE: Record<string, PillTone> = {
  installed: "positive",
  pending_install: "warning",
  failed: "danger",
};

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: PillTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function billingStatusTone(status: string): PillTone {
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

// Shared tile shell so Account / Agent / Add cards line up with consistent
// height behaviour and the existing rounded-2xl card styling.
const TILE_BASE =
  "flex h-full flex-col rounded-2xl bg-white shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] dark:bg-zinc-950 dark:ring-white/[0.06]";

function avatarInitial(seed: string): string {
  return (seed.trim()[0] ?? "?").toUpperCase();
}

export function MeAgentsGrid({
  account,
  agents,
  maxPerUser,
  canCreate,
  canCreateReason,
  slackUserIDKnown,
  ownerName,
  ownerSlackUserId,
  ownerEmail,
}: Props) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const count = agents.length;

  // Slack identity missing: can't bind an agent. Show the full-width human card +
  // the join notice; no agent tiles, no add tile (mirrors the prior
  // no_slack_user_id behaviour).
  if (!slackUserIDKnown) {
    return (
      <>
        <AccountCard account={account} />
        <div className="rounded-2xl bg-white p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] sm:p-6 dark:bg-zinc-950 dark:ring-white/[0.06]">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Your email isn&apos;t in the MakeaCompany Slack workspace yet, so we can&apos;t bind an
            agent to your Slack identity. Join the workspace, then refresh.
          </p>
        </div>
      </>
    );
  }

  const openAgent = overlay?.kind === "agent" ? agents.find((a) => a.agentId === overlay.agentId) : undefined;
  const showAddTile =
    !(count >= maxPerUser) &&
    canCreateReason !== "max_reached" &&
    canCreateReason !== "no_slack_user_id";

  return (
    <>
      {/* Full-width "this is you" card on top. */}
      <AccountCard account={account} />

      {/* Agents section: header + 3-column grid of light tiles + Add tile. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Agents
          </h2>
          <span className="text-sm font-medium tabular-nums text-muted-foreground/70">
            · {count}/{maxPerUser}
          </span>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentTile
              key={agent.agentId ?? agent.slackAppId ?? agent.displayName}
              agent={agent}
              onOpen={() => {
                const id = agent.agentId ?? "";
                if (id) setOverlay({ kind: "agent", agentId: id });
              }}
            />
          ))}

          {showAddTile ? (
            <AddTile
              canCreate={canCreate}
              canCreateReason={canCreateReason}
              onOpen={() => setOverlay({ kind: "create" })}
            />
          ) : null}
        </div>
      </section>

      {/* Detail overlay — reuses the existing status panel / creation form
          verbatim so all per-agent agentId threading stays unchanged. */}
      <MeDetailOverlay
        open={overlay !== null}
        onClose={() => setOverlay(null)}
        title={
          overlay?.kind === "create"
            ? "New agent"
            : openAgent?.displayName?.trim()
              ? `${openAgent.displayName.trim()} details`
              : "Agent details"
        }
      >
        {overlay?.kind === "create" ? (
          <section className="rounded-2xl bg-white p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] sm:p-6 dark:bg-zinc-950 dark:ring-white/[0.06]">
            <h3 className="mb-4 pr-8 text-base font-semibold tracking-tight text-foreground">
              New agent
            </h3>
            {/* On a successful create the form calls router.refresh(), which
                re-fetches the envelope so the new tile renders. */}
            <MePersonalAgentCreationForm />
          </section>
        ) : openAgent ? (
          <MePersonalAgentStatusPanel
            // Remount when the selected agent changes so the panel's internal
            // state (edit form, polling) re-seeds from the right record.
            key={openAgent.agentId}
            initial={{ ...openAgent, hasAgent: true }}
            ownerName={ownerName}
            ownerSlackUserId={ownerSlackUserId}
            ownerEmail={ownerEmail}
          />
        ) : null}
      </MeDetailOverlay>
    </>
  );
}

// LabeledRow renders a left-aligned label + value pair, like the original
// ProfileCard. Used in the human card's billing column for read-as-you details.
function LabeledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

// AccountCard — the full-width "this is you" card on top of the page. Roomier
// than the old compact tile: left identity block (avatar + name + email + Slack
// user ID) and a right billing block (plan badges + renew/end date + the
// Subscribe / Cancel action).
function AccountCard({ account }: { account: AccountInfo }) {
  const {
    email,
    displayName,
    portraitUrl,
    slackUserId,
    subscriptionStatus,
    tier,
    freeLifetime,
    cancelAtPeriodEnd,
    periodEndLabel,
    canCancel,
    subscribeUrl,
  } = account;

  const hasAnyPlan = Boolean(
    subscriptionStatus || tier || freeLifetime || cancelAtPeriodEnd,
  );

  return (
    <section className={`${TILE_BASE} w-full`}>
      <div className="flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-stretch lg:gap-10">
        {/* Identity block */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/90 text-2xl font-semibold text-background"
          >
            {portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Slack CDN URL, fine to skip next/image optimization
              <img src={portraitUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <span>{avatarInitial(displayName || email)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              This is you
            </p>
            <h2 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-foreground">
              {displayName || "Account"}
            </h2>
            <p className="truncate text-sm text-muted-foreground" title={email}>
              {email || "No email"}
            </p>
            {slackUserId ? (
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground/80" title={slackUserId}>
                Slack ID · {slackUserId}
              </p>
            ) : null}
          </div>
        </div>

        {/* Billing block */}
        <div className="flex w-full flex-col gap-2 border-t border-border/60 pt-6 lg:w-80 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {subscriptionStatus ? (
              <Pill tone={billingStatusTone(subscriptionStatus)}>{subscriptionStatus}</Pill>
            ) : null}
            {tier ? <Pill>{tier}</Pill> : null}
            {freeLifetime ? <Pill tone="positive">free lifetime</Pill> : null}
            {cancelAtPeriodEnd ? <Pill tone="warning">cancels at period end</Pill> : null}
            {!hasAnyPlan ? (
              <span className="text-xs text-muted-foreground">No active plan</span>
            ) : null}
          </div>

          {periodEndLabel ? (
            <LabeledRow label={cancelAtPeriodEnd ? "Ends" : "Renews"}>
              {periodEndLabel}
            </LabeledRow>
          ) : null}

          <div className="mt-auto pt-2">
            {canCancel ? (
              <MeCancelSubscriptionButton />
            ) : subscribeUrl ? (
              <a
                href={subscribeUrl}
                className="inline-flex h-9 w-full items-center justify-center rounded-xl border-2 border-foreground/15 bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                Subscribe — $99/mo
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentTile({ agent, onOpen }: { agent: AgentRecord; onOpen: () => void }) {
  const displayName = (agent.displayName ?? "").trim() || "Untitled agent";
  const description = (agent.description ?? "").trim();
  const status = (agent.status ?? "").trim();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${displayName} details`}
      className={`${TILE_BASE} group cursor-pointer text-left transition-shadow duration-200 hover:shadow-[0_18px_50px_-12px_rgba(0,0,0,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30`}
    >
      <div className="flex items-center gap-3.5 border-b border-border/60 p-5">
        <AgentAvatar agent={agent} displayName={displayName} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
            {displayName}
          </h2>
          <span className="mt-1 inline-flex flex-wrap items-center gap-1.5">
            {status ? <Pill tone={STATUS_TONE[status] ?? "neutral"}>{status}</Pill> : null}
            {/* Kind pill is always shown so team-vs-personal is legible at a glance. */}
            <Pill tone={agent.teamMode ? "positive" : "neutral"}>
              {agent.teamMode ? "Team" : "Personal"}
            </Pill>
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {description || "No description yet."}
        </p>
        <span className="mt-auto pt-4 text-xs font-medium text-muted-foreground transition group-hover:text-foreground">
          View details →
        </span>
      </div>
    </button>
  );
}

// Resolves the tile avatar the same way the panel does: the pre-install icon
// cache (localStorage) covers agents whose Slack bot photo doesn't exist yet.
function AgentAvatar({ agent, displayName }: { agent: AgentRecord; displayName: string }) {
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);

  // Hydrate from the shared icon cache on mount (client-only). Avoids a flash
  // of the initial for freshly created / pending-install agents.
  useEffect(() => {
    const cached = readCachedAgentIcon(agent.agentId ?? agent.slackAppId);
    if (cached?.base64 && cached.mimeType) {
      setCachedUrl(`data:${cached.mimeType};base64,${cached.base64}`);
    }
  }, [agent.agentId, agent.slackAppId]);

  return (
    <div
      aria-hidden
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground/90 text-lg font-semibold text-background"
    >
      {cachedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL / Slack CDN URL
        <img src={cachedUrl} alt={displayName} className="h-full w-full object-cover" />
      ) : (
        <span>{avatarInitial(displayName)}</span>
      )}
    </div>
  );
}

function AddTile({
  canCreate,
  canCreateReason,
  onOpen,
}: {
  canCreate: boolean;
  canCreateReason: CanCreateReason;
  onOpen: () => void;
}) {
  const disabled = !canCreate;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label="Add agent"
      className={`group flex h-full min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
        disabled
          ? "cursor-not-allowed border-border/60 bg-muted/20"
          : "border-border bg-white/40 hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:bg-zinc-950/40 dark:hover:bg-zinc-900/40"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition ${
          disabled
            ? "border-border/60 text-muted-foreground/50"
            : "border-border text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground"
        }`}
      >
        <Plus size={22} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={`text-sm font-medium ${disabled ? "text-muted-foreground/60" : "text-foreground"}`}>
        Add agent
      </span>
      {disabled && canCreateReason === "prior_not_installed" ? (
        <span className="max-w-xs text-xs text-muted-foreground">
          Finish installing your last agent before adding another.
        </span>
      ) : null}
    </button>
  );
}

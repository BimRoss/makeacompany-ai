"use client";

import { Lock, Users, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CompanyChannel } from "@/lib/admin/company-channels";
import {
  AdminChannelKnowledgeActivityChart,
  type KnowledgeActivityTimeBin,
} from "@/components/admin/admin-channel-knowledge-activity-chart";
import { useWorkspaceNavbarTrail } from "@/components/workspace-navbar-trail-provider";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
import { SlackPersonChip } from "@/components/admin/slack-person-chip";
import { useIsMdLayout } from "@/hooks/use-is-md-layout";

type PaneStatus = "loading" | "missing" | "error" | "ready";

export type AdminChannelFounder = {
  displayName: string;
  portraitUrl?: string;
};

type AdminChannelControlPaneProps = {
  channelId: string;
  channel: CompanyChannel | null;
  status: PaneStatus;
  errorMessage?: string;
  redisKey?: string;
  onChannelUpdated: (ch: CompanyChannel) => void;
  /** Defaults to admin API; use `portal` for company portal pages. */
  companyChannelsApiPrefix?: "admin" | "portal";
  /** Shown in the card header (top row), e.g. display name or channel id while loading. */
  workspaceTitle: string;
  /** Registry `owner_ids` resolved to names + portraits; shown in the site header from `md` up. */
  founders?: AdminChannelFounder[] | null;
  /** Channel digest markdown (same payload as Knowledge Base) for the activity chart. */
  knowledgeMarkdown?: string | null;
  /** Hovering an activity bar scopes the Knowledge Base when no bucket is pinned. */
  onKnowledgeActivityBinHover?: (bin: KnowledgeActivityTimeBin | null) => void;
  /** Pinned activity bucket (click a bar); takes precedence over hover for the Knowledge Base filter. */
  knowledgeActivityPinnedBin?: KnowledgeActivityTimeBin | null;
  onKnowledgeActivityPinnedBinChange?: (bin: KnowledgeActivityTimeBin | null) => void;
  /** From Slack member-channels when this workspace id appears in the bot’s conversation list. */
  slackChannelIsPrivate?: boolean | null;
};

function ControlToggle({
  enabled,
  disabled,
  busy,
  onToggle,
  ariaLabel,
  comingSoon,
}: {
  enabled: boolean;
  disabled: boolean;
  busy?: boolean;
  onToggle: () => void;
  ariaLabel: string;
  /** Looks disabled but stays clickable so `onToggle` can run (e.g. toast). */
  comingSoon?: boolean;
}) {
  const domDisabled = comingSoon ? false : disabled || (busy ?? false);
  const dimmed = comingSoon || disabled || (busy ?? false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy ?? false}
      aria-disabled={comingSoon ? true : undefined}
      aria-label={ariaLabel}
      disabled={domDisabled}
      onClick={onToggle}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring",
        enabled ? "border-foreground/30 bg-foreground" : "border-border bg-muted/60",
        dimmed ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none block size-6 translate-y-px rounded-full bg-background shadow-sm ring-1 ring-border transition-transform",
          enabled ? "translate-x-[1.35rem]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

export function AdminChannelControlPane({
  channelId,
  channel,
  status,
  errorMessage,
  redisKey,
  onChannelUpdated,
  companyChannelsApiPrefix = "admin",
  workspaceTitle,
  founders,
  knowledgeMarkdown,
  onKnowledgeActivityBinHover,
  knowledgeActivityPinnedBin,
  onKnowledgeActivityPinnedBinChange,
  slackChannelIsPrivate,
}: AdminChannelControlPaneProps) {
  const { setWorkspaceNavbarTrail, setWorkspaceNavbarEndLead } = useWorkspaceNavbarTrail();
  const flash = useAdminFlashToast();
  const isMdLayout = useIsMdLayout();
  const settingsColumnRef = useRef<HTMLDivElement | null>(null);
  const [settingsColumnHeightPx, setSettingsColumnHeightPx] = useState<number | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const flashComingSoon = useCallback(() => {
    flash("success", "Coming Soon!");
  }, [flash]);
  const [busy, setBusy] = useState(false);
  const apiCompany = `/api/${companyChannelsApiPrefix}/company-channels`;

  const patchChannel = useCallback(
    async (body: Record<string, boolean | number>) => {
      if (!channel) return;
      setPatchError(null);
      setBusy(true);
      try {
        const res = await fetch(`${apiCompany}/${encodeURIComponent(channelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const flow = companyChannelsApiPrefix === "portal" ? "portal" : "admin";
        if (kickToLoginForUnauthorizedApi(res.status, flow, companyChannelsApiPrefix === "portal" ? channelId : undefined)) {
          return;
        }
        const payload = (await res.json().catch(() => null)) as { channel?: CompanyChannel; error?: string } | null;
        if (!res.ok || !payload?.channel) {
          setPatchError(payload?.error ?? "Update failed.");
          return;
        }
        onChannelUpdated(payload.channel);
      } catch {
        setPatchError("Network error.");
      } finally {
        setBusy(false);
      }
    },
    [apiCompany, channel, channelId, companyChannelsApiPrefix, onChannelUpdated],
  );

  useLayoutEffect(() => {
    if (status !== "ready" || !channel) {
      setSettingsColumnHeightPx(null);
      return;
    }
    const el = settingsColumnRef.current;
    if (!el) {
      return;
    }
    const apply = () => setSettingsColumnHeightPx(Math.round(el.getBoundingClientRect().height));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [status, channelId]);

  const ownerIds = channel?.owner_ids;
  const founderIdsNormalized = useMemo(
    () => ownerIds?.map((id) => id.trim()).filter(Boolean).map((id) => id.toUpperCase()) ?? [],
    [ownerIds],
  );

  const foundersSignature = useMemo(() => {
    if (founderIdsNormalized.length === 0) {
      return "";
    }
    return founderIdsNormalized
      .map((id, i) => {
        const f = founders?.[i];
        return `${id}\u0001${f?.displayName ?? ""}\u0001${f?.portraitUrl ?? ""}`;
      })
      .join("\u0002");
  }, [founderIdsNormalized, founders]);

  const founderEntries = useMemo(() => {
    if (!foundersSignature) {
      return [] as { id: string; displayName: string; portraitUrl?: string }[];
    }
    return foundersSignature.split("\u0002").map((chunk) => {
      const [id, displayName, portraitUrl] = chunk.split("\u0001");
      return {
        id: id ?? "",
        displayName: displayName || "Member",
        portraitUrl: portraitUrl || undefined,
      };
    });
  }, [foundersSignature]);

  const founderNavbarLead = useMemo(() => {
    if (founderEntries.length === 0) {
      return null;
    }
    return (
      <div className="flex min-h-11 min-w-0 items-center justify-end gap-1" aria-label="Company founders">
        {founderEntries.map((entry) => (
          <span key={`founder-${entry.id}`} className="min-w-0 shrink" title={`Slack user ${entry.id}`}>
            <SlackPersonChip displayName={entry.displayName} portraitUrl={entry.portraitUrl} size="nav" />
          </span>
        ))}
      </div>
    );
  }, [founderEntries]);

  const clearPinnedActivity = useCallback(() => {
    onKnowledgeActivityPinnedBinChange?.(null);
    onKnowledgeActivityBinHover?.(null);
  }, [onKnowledgeActivityPinnedBinChange, onKnowledgeActivityBinHover]);

  const showPinnedActivityClear = Boolean(
    knowledgeActivityPinnedBin && onKnowledgeActivityPinnedBinChange,
  );

  const activitySection = (
    <div
      className="flex min-w-0 max-md:shrink-0 flex-col -ml-2 max-md:-mr-0.5 md:mx-0 md:flex-1 md:min-h-0"
      aria-label="Message activity from knowledge digest"
    >
      <AdminChannelKnowledgeActivityChart
        markdown={knowledgeMarkdown ?? ""}
        pinnedBin={knowledgeActivityPinnedBin ?? null}
        onPinnedBinChange={onKnowledgeActivityPinnedBinChange}
        onBinHover={onKnowledgeActivityBinHover}
      />
    </div>
  );

  const navbarTrail = useMemo(
    () => (
      <span className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-snug tracking-tight text-foreground motion-colors sm:text-lg">
        {slackChannelIsPrivate === true ? (
          <span className="inline-flex shrink-0 text-muted-foreground" title="Private Slack channel" aria-hidden>
            <Lock className="size-3.5 stroke-[2.25]" />
          </span>
        ) : null}
        {slackChannelIsPrivate === true ? <span className="sr-only">Private Slack channel: </span> : null}
        {slackChannelIsPrivate === false ? (
          <span className="inline-flex shrink-0 text-muted-foreground" title="Public channel" aria-hidden>
            <Users className="size-3.5 stroke-[2.25]" />
          </span>
        ) : null}
        {slackChannelIsPrivate === false ? <span className="sr-only">Public channel: </span> : null}
        <span className="min-w-0 truncate font-display tracking-[-0.02em]">{workspaceTitle}</span>
      </span>
    ),
    [slackChannelIsPrivate, workspaceTitle],
  );

  useEffect(() => {
    setWorkspaceNavbarTrail(navbarTrail);
    return () => setWorkspaceNavbarTrail(null);
  }, [navbarTrail, setWorkspaceNavbarTrail]);

  useEffect(() => {
    setWorkspaceNavbarEndLead(founderNavbarLead);
    return () => setWorkspaceNavbarEndLead(null);
  }, [founderNavbarLead, setWorkspaceNavbarEndLead]);

  const activityMaxHeightStyle =
    isMdLayout && settingsColumnHeightPx != null ? { maxHeight: settingsColumnHeightPx } : undefined;

  const activityColumn = (
    <div
      className="relative order-2 flex min-w-0 min-h-0 flex-1 flex-col space-y-3 md:order-1 md:min-h-0"
      style={activityMaxHeightStyle}
    >
      {showPinnedActivityClear ? (
        <button
          type="button"
          onClick={clearPinnedActivity}
          className="pointer-events-auto absolute right-2 top-2 z-20 flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md backdrop-blur-[2px] transition-[background-color,transform] hover:bg-muted/90 active:scale-[0.97] md:size-9"
          aria-label="Clear pinned time range"
          title="Clear pinned time range"
        >
          <X className="size-5 md:size-4" strokeWidth={2.25} strokeLinecap="round" />
        </button>
      ) : null}
      {activitySection}
    </div>
  );

  const cardShell = "rounded-2xl border border-border bg-card px-4 py-3 shadow-sm";

  const sideShell = (child: ReactNode) => (
    <div className="order-1 min-w-0 shrink-0 border-t border-border pt-3 max-md:border-t-0 max-md:pt-0 md:order-2 md:border-l md:border-t-0 md:pl-6 md:pt-0">
      {child}
    </div>
  );

  const paneShell = (card: ReactNode) => <div className="flex shrink-0 flex-col">{card}</div>;

  if (status === "loading") {
    return paneShell(
      <section className={cardShell} aria-busy="true" aria-label="Channel workspace">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          {activityColumn}
          {sideShell(<p className="text-xs text-muted-foreground">Loading channel registry…</p>)}
        </div>
      </section>,
    );
  }

  if (status === "error") {
    return paneShell(
      <section
        className="rounded-2xl border border-destructive/40 bg-card px-4 py-3.5 shadow-sm"
        aria-label="Channel workspace"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          {activityColumn}
          {sideShell(<p className="text-xs text-destructive">{errorMessage ?? "Could not load channel metadata."}</p>)}
        </div>
      </section>,
    );
  }

  if (status === "missing" || !channel) {
    return paneShell(
      <section className={cardShell} aria-label="Channel workspace">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          {activityColumn}
          {sideShell(
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Not in registry ({redisKey ?? "employee-factory:company_channels"}).
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">{channelId}</p>
            </div>,
          )}
        </div>
      </section>,
    );
  }

  const reactionsOn = channel.general_auto_reaction_enabled ?? false;
  const generalOn = !channel.general_responses_muted;

  return paneShell(
    <section className={cardShell} aria-label="Channel workspace">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        {activityColumn}
        <div
          ref={settingsColumnRef}
          className="order-1 min-w-[min(100%,14rem)] shrink-0 border-t border-border max-md:border-t-0 md:order-2 md:border-l md:border-t-0 md:pl-6"
          aria-label="Employee settings"
        >
          <p className="mb-2 w-full shrink-0 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Employee Settings
          </p>
          <div className="divide-y divide-border" aria-label="Employee setting toggles">
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span
              className="max-w-[11rem] text-xs font-medium text-foreground"
              title="When off, agents only reply when directly addressed (@mention, @here, @channel, @everyone). When on, agents may join general channel messages and threads (last to speak)."
            >
              Last To Speak
            </span>
            <ControlToggle
              enabled={generalOn}
              disabled={false}
              busy={busy}
              onToggle={() => void patchChannel({ general_responses_muted: generalOn })}
              ariaLabel={
                generalOn
                  ? "Turn off last to speak on general messages and threads"
                  : "Turn on last to speak on general messages and threads"
              }
            />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span
              className="max-w-[11rem] text-xs font-medium text-foreground"
              title="When off, no agent reactions (no sentiment thumbs on general messages, no mirroring). When on, sentiment and reaction mirroring are enabled."
            >
              Reactions
            </span>
            <ControlToggle
              enabled={reactionsOn}
              disabled={false}
              busy={busy}
              onToggle={() => void patchChannel({ general_auto_reaction_enabled: !reactionsOn })}
              ariaLabel={reactionsOn ? "Turn off reactions" : "Turn on reactions"}
            />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Emotions</span>
            <ControlToggle
              enabled={false}
              disabled={false}
              comingSoon
              onToggle={flashComingSoon}
              ariaLabel="Emotions (coming soon)"
            />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Passive Banter</span>
            <ControlToggle
              enabled={false}
              disabled={false}
              comingSoon
              onToggle={flashComingSoon}
              ariaLabel="Passive Banter (coming soon)"
            />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Out of Office</span>
            <ControlToggle
              enabled={false}
              disabled={false}
              comingSoon
              onToggle={flashComingSoon}
              ariaLabel="Out of Office (coming soon)"
            />
            </div>
          </div>
        </div>
      </div>
      {patchError ? <p className="pt-1 text-xs text-destructive">{patchError}</p> : null}
    </section>,
  );
}

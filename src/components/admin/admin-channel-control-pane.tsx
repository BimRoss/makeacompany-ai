"use client";

import { Lock, Users, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CompanyChannel } from "@/lib/admin/company-channels";
import {
  AdminChannelKnowledgeActivityChart,
  type KnowledgeActivityTimeBin,
} from "@/components/admin/admin-channel-knowledge-activity-chart";
import { useWorkspaceNavbarTrail } from "@/components/workspace-navbar-trail-provider";
import { SlackPersonChip } from "@/components/admin/slack-person-chip";
import { PortalWorkspaceProfileNavButton } from "@/components/portal/portal-workspace-profile";
import { useIsMdLayout } from "@/hooks/use-is-md-layout";

type PaneStatus = "loading" | "missing" | "error" | "ready";

export type ChannelWorkspaceViewerChip = {
  displayName: string;
  portraitUrl?: string;
};

type AdminChannelControlPaneProps = {
  channelId: string;
  channel: CompanyChannel | null;
  status: PaneStatus;
  errorMessage?: string;
  redisKey?: string;
  /** Defaults to admin API; use `portal` for company portal pages. */
  companyChannelsApiPrefix?: "admin" | "portal";
  /** Shown in the card header (top row), e.g. display name or channel id while loading. */
  workspaceTitle: string;
  /** Signed-in admin/portal user for the site header chip (from session + optional Slack profile match). */
  viewerNavbarIdentity?: ChannelWorkspaceViewerChip | null;
  /** Channel digest markdown (same payload as Knowledge Base) for the activity chart. */
  knowledgeMarkdown?: string | null;
  /** Pinned activity bucket (click a bar); scopes the Knowledge Base until unpinned. */
  knowledgeActivityPinnedBin?: KnowledgeActivityTimeBin | null;
  onKnowledgeActivityPinnedBinChange?: (bin: KnowledgeActivityTimeBin | null) => void;
  /** From Slack member-channels when this workspace id appears in the bot’s conversation list. */
  slackChannelIsPrivate?: boolean | null;
};

function ControlToggle({
  enabled,
  disabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  const domDisabled = disabled;
  const dimmed = disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
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
  companyChannelsApiPrefix = "admin",
  workspaceTitle,
  viewerNavbarIdentity,
  knowledgeMarkdown,
  knowledgeActivityPinnedBin,
  onKnowledgeActivityPinnedBinChange,
  slackChannelIsPrivate,
}: AdminChannelControlPaneProps) {
  const { setWorkspaceNavbarTrail, setWorkspaceNavbarEndLead } = useWorkspaceNavbarTrail();
  const isMdLayout = useIsMdLayout();
  const settingsColumnRef = useRef<HTMLDivElement | null>(null);
  const [settingsColumnHeightPx, setSettingsColumnHeightPx] = useState<number | null>(null);

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
  }, [status, channelId, channel]);

  const viewerNavbarLead = useMemo(() => {
    const v = viewerNavbarIdentity;
    if (!v) {
      return null;
    }
    const name = v.displayName.trim();
    if (!name) {
      return null;
    }
    if (companyChannelsApiPrefix === "portal") {
      return (
        <div className="flex min-h-11 min-w-0 items-center justify-end gap-1">
          <PortalWorkspaceProfileNavButton channelId={channelId} displayName={name} portraitUrl={v.portraitUrl} />
        </div>
      );
    }
    return (
      <div className="flex min-h-11 min-w-0 items-center justify-end gap-1" aria-label="Signed-in user">
        <span className="min-w-0 shrink">
          <SlackPersonChip displayName={name} portraitUrl={v.portraitUrl} size="nav" />
        </span>
      </div>
    );
  }, [viewerNavbarIdentity, companyChannelsApiPrefix, channelId]);

  const clearPinnedActivity = useCallback(() => {
    onKnowledgeActivityPinnedBinChange?.(null);
  }, [onKnowledgeActivityPinnedBinChange]);

  /** Stable no-op for read-only toggles; must be declared before status early-returns (hooks order). */
  const noopToggle = useCallback(() => {}, []);

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
      />
    </div>
  );

  const navbarTrail = useMemo(
    () => (
      <span className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold leading-snug tracking-tight text-foreground motion-colors sm:gap-3 sm:text-lg">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
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
      </span>
    ),
    [slackChannelIsPrivate, workspaceTitle],
  );

  useEffect(() => {
    setWorkspaceNavbarTrail(navbarTrail);
    return () => setWorkspaceNavbarTrail(null);
  }, [navbarTrail, setWorkspaceNavbarTrail]);

  useEffect(() => {
    setWorkspaceNavbarEndLead(viewerNavbarLead);
    return () => setWorkspaceNavbarEndLead(null);
  }, [viewerNavbarLead, setWorkspaceNavbarEndLead]);

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
                Not in registry ({redisKey ?? "agent-factory:company_channels"}).
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">{channelId}</p>
            </div>,
          )}
        </div>
      </section>,
    );
  }

  const oooOn = channel.out_of_office_enabled ?? false;

  return paneShell(
    <section className={cardShell} aria-label="Channel workspace">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        {activityColumn}
        <div
          ref={settingsColumnRef}
          className="order-1 min-w-[min(100%,14rem)] shrink-0 border-t border-border max-md:border-t-0 md:order-2 md:border-l md:border-t-0 md:pl-6"
          aria-label="Team settings"
        >
          <p className="mb-2 w-full shrink-0 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Team Settings
          </p>
          <div className="divide-y divide-border" aria-label="Team setting toggles (read-only)">
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Emotions</span>
              <ControlToggle enabled={false} disabled onToggle={noopToggle} ariaLabel="Emotions (disabled)" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Passive Banter</span>
              <ControlToggle enabled={false} disabled onToggle={noopToggle} ariaLabel="Passive Banter (disabled)" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Out of Office</span>
              <ControlToggle
                enabled={oooOn}
                disabled
                onToggle={noopToggle}
                ariaLabel={`Out of office is ${oooOn ? "on" : "off"} (read-only)`}
              />
            </div>
          </div>
        </div>
      </div>
    </section>,
  );
}

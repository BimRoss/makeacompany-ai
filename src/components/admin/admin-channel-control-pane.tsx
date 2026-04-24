"use client";

import { Lock, Users } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { CompanyChannel } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { SlackPersonChip } from "@/components/admin/slack-person-chip";

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
  /** Registry `owner_ids` resolved to names + portraits for the founders row. */
  founders?: AdminChannelFounder[] | null;
  /** From Slack member-channels when this workspace id appears in the bot’s conversation list. */
  slackChannelIsPrivate?: boolean | null;
};

function ControlToggle({
  enabled,
  disabled,
  busy,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  disabled: boolean;
  busy?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy ?? false}
      aria-label={ariaLabel}
      disabled={disabled || (busy ?? false)}
      onClick={onToggle}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring",
        enabled ? "border-foreground/30 bg-foreground" : "border-border bg-muted/60",
        disabled || busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
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
  slackChannelIsPrivate,
}: AdminChannelControlPaneProps) {
  const [patchError, setPatchError] = useState<string | null>(null);
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

  const founderIdsNormalized =
    channel?.owner_ids?.map((id) => id.trim()).filter(Boolean).map((id) => id.toUpperCase()) ?? [];

  const foundersSection =
    founderIdsNormalized.length > 0 ? (
      <div
        className="rounded-xl border border-border/70 bg-gradient-to-br from-muted/60 via-muted/25 to-background p-3.5 shadow-[0_1px_0_0_rgba(0,0,0,0.03)] dark:from-muted/25 dark:via-muted/10 dark:to-card dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)]"
        aria-label="Company founders"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Founders</p>
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2">
          {founderIdsNormalized.map((id, i) => {
            const f = founders?.[i];
            return (
              <span key={`founder-${id}`} title={`Slack user ${id}`}>
                <SlackPersonChip
                  displayName={f?.displayName ?? "Member"}
                  portraitUrl={f?.portraitUrl}
                  size="comfortable"
                />
              </span>
            );
          })}
        </div>
      </div>
    ) : null;

  const visibilityIcon =
    slackChannelIsPrivate === true ? (
      <span className="inline-flex shrink-0 text-muted-foreground" title="Private Slack channel" aria-hidden>
        <Lock className="size-7 stroke-[2.25]" />
      </span>
    ) : slackChannelIsPrivate === false ? (
      <span className="inline-flex shrink-0 text-muted-foreground" title="Public channel" aria-hidden>
        <Users className="size-7 stroke-[2.25]" />
      </span>
    ) : null;

  const metaBlock = (
    <div className="min-w-0 flex-1 space-y-3">
      <h1 className="flex min-w-0 max-w-full items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
        {visibilityIcon ? (
          <>
            {visibilityIcon}
            {slackChannelIsPrivate === true ? <span className="sr-only">Private Slack channel: </span> : null}
            {slackChannelIsPrivate === false ? <span className="sr-only">Public channel: </span> : null}
          </>
        ) : null}
        <span className="min-w-0 truncate">{workspaceTitle}</span>
      </h1>
      {foundersSection}
    </div>
  );

  const cardShell = "rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm";

  const sideShell = (child: ReactNode) => (
    <div className="min-w-0 shrink-0 border-t border-border pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">{child}</div>
  );

  if (status === "loading") {
    return (
      <section className={cardShell} aria-busy="true" aria-label="Channel workspace">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          {metaBlock}
          {sideShell(<p className="text-xs text-muted-foreground">Loading channel registry…</p>)}
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section
        className="rounded-2xl border border-destructive/40 bg-card px-4 py-3.5 shadow-sm"
        aria-label="Channel workspace"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          {metaBlock}
          {sideShell(<p className="text-xs text-destructive">{errorMessage ?? "Could not load channel metadata."}</p>)}
        </div>
      </section>
    );
  }

  if (status === "missing" || !channel) {
    return (
      <section className={cardShell} aria-label="Channel workspace">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          {metaBlock}
          {sideShell(
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Not in registry ({redisKey ?? "employee-factory:company_channels"}).
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">{channelId}</p>
            </div>,
          )}
        </div>
      </section>
    );
  }

  const reactionsOn = channel.general_auto_reaction_enabled ?? false;
  const generalOn = !channel.general_responses_muted;

  return (
    <section className={cardShell} aria-label="Channel workspace">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        {metaBlock}
        <div
          className="min-w-[min(100%,14rem)] shrink-0 divide-y divide-border border-t border-border md:border-l md:border-t-0 md:pl-6"
          aria-label="Channel controls"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-xs font-medium text-foreground">Respond to General Messages</span>
            <ControlToggle
              enabled={generalOn}
              disabled={false}
              busy={busy}
              onToggle={() => void patchChannel({ general_responses_muted: generalOn })}
              ariaLabel={generalOn ? "Turn off general responses" : "Turn on general responses"}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-xs font-medium text-foreground">Employee Reaction Mirroring</span>
            <ControlToggle
              enabled={reactionsOn}
              disabled={false}
              busy={busy}
              onToggle={() => void patchChannel({ general_auto_reaction_enabled: !reactionsOn })}
              ariaLabel={reactionsOn ? "Turn off reaction mirroring" : "Turn on reaction mirroring"}
            />
          </div>
        </div>
      </div>
      {patchError ? <p className="pt-1 text-xs text-destructive">{patchError}</p> : null}
    </section>
  );
}

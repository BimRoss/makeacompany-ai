"use client";

import { UserRound } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { CompanyChannel } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

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
  /** Slack channel id — shown as a pill on the metadata row with founder ids. */
  workspaceChannelId: string;
  /** Registry owners resolved to names + portraits; never show raw Slack user ids in the UI. */
  founders?: AdminChannelFounder[] | null;
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

function FounderChip({ founder }: { founder: AdminChannelFounder }) {
  const url = founder.portraitUrl?.trim();
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 py-0.5 pl-0.5 pr-2.5">
      <span className="relative size-6 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground" aria-hidden>
            <UserRound className="size-3" />
          </span>
        )}
      </span>
      <span className="truncate text-xs font-medium leading-none text-foreground">{founder.displayName}</span>
    </span>
  );
}

function MetadataIdPill({ children, title }: { children: string; title?: string }) {
  return (
    <span
      className="inline-flex max-w-full shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums leading-none text-muted-foreground"
      title={title}
    >
      <span className="truncate">{children}</span>
    </span>
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
  workspaceChannelId,
  founders,
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

  const foundersRow =
    founders == null ? null : founders.length === 0 ? (
      <p className="text-xs leading-snug text-muted-foreground">No founders configured for this channel.</p>
    ) : (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {founders.map((f, i) => (
          <FounderChip key={`${f.displayName}-${i}`} founder={f} />
        ))}
      </div>
    );

  const founderIdsNormalized =
    channel?.owner_ids?.map((id) => id.trim()).filter(Boolean).map((id) => id.toUpperCase()) ?? [];

  const idsRow = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Slack identifiers">
      <MetadataIdPill title="Slack channel id">{workspaceChannelId}</MetadataIdPill>
      {founderIdsNormalized.length > 0
        ? founderIdsNormalized.map((id) => (
            <MetadataIdPill key={id} title="Slack user id (founder)">
              {id}
            </MetadataIdPill>
          ))
        : null}
    </div>
  );

  const metaBlock = (
    <div className="min-w-0 flex-1 space-y-2">
      <h1 className="min-w-0 max-w-full truncate text-2xl font-semibold tracking-tight text-foreground">
        {workspaceTitle}
      </h1>
      {foundersRow}
      {idsRow}
    </div>
  );

  const sideShell = (child: ReactNode) => (
    <div className="min-w-0 shrink-0 border-t border-border pt-2 md:border-l md:border-t-0 md:pl-5 md:pt-0">{child}</div>
  );

  if (status === "loading") {
    return (
      <section
        className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
        aria-busy="true"
        aria-label="Channel workspace"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-5">
          {metaBlock}
          {sideShell(<p className="text-xs text-muted-foreground">Loading channel registry…</p>)}
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="rounded-lg border border-destructive/40 bg-card px-3 py-2 shadow-sm" aria-label="Channel workspace">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-5">
          {metaBlock}
          {sideShell(<p className="text-xs text-destructive">{errorMessage ?? "Could not load channel metadata."}</p>)}
        </div>
      </section>
    );
  }

  if (status === "missing" || !channel) {
    return (
      <section className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm" aria-label="Channel workspace">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-5">
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
    <section className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm" aria-label="Channel workspace">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-5">
        {metaBlock}
        <div
          className="min-w-[min(100%,14rem)] shrink-0 divide-y divide-border border-t border-border md:border-l md:border-t-0 md:pl-5"
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

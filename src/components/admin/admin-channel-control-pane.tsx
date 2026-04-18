"use client";

import { useCallback, useState } from "react";
import { channelDisplayTitle, type CompanyChannel } from "@/lib/admin/company-channels";

type PaneStatus = "loading" | "missing" | "error" | "ready";

type AdminChannelControlPaneProps = {
  channelId: string;
  channel: CompanyChannel | null;
  status: PaneStatus;
  errorMessage?: string;
  redisKey?: string;
  /** When true, registry toggles are hidden (read-only view). */
  readOnly?: boolean;
  onChannelUpdated: (ch: CompanyChannel) => void;
};

/** Read-only registry field: label + value in one pill for consistent scanning. */
function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex max-w-full min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-muted/35 px-3 py-2 text-left shadow-sm sm:max-w-[min(100%,36rem)] sm:flex-row sm:items-baseline sm:gap-2"
      title={`${label}: ${value}`}
    >
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}:</span>
      <span className="min-w-0 break-all font-mono text-xs leading-snug text-foreground">{value}</span>
    </div>
  );
}

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
  readOnly = false,
  onChannelUpdated,
}: AdminChannelControlPaneProps) {
  const [patchError, setPatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patchChannel = useCallback(
    async (body: Record<string, boolean | number>) => {
      if (readOnly || !channel) return;
      setPatchError(null);
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/company-channels/${encodeURIComponent(channelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
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
    [channel, channelId, onChannelUpdated, readOnly],
  );

  if (status === "loading") {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading channel registry…</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="rounded-lg border border-destructive/40 bg-card px-4 py-4 shadow-sm">
        <p className="text-sm text-destructive">{errorMessage ?? "Could not load channel metadata."}</p>
      </section>
    );
  }

  if (status === "missing" || !channel) {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm">
        <p className="text-sm text-muted-foreground">
          Not in registry ({redisKey ?? "employee-factory:company_channels"}).
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{channelId}</p>
      </section>
    );
  }

  const title = channelDisplayTitle(channel);
  const owners = channel.owner_ids?.map((id) => id.trim()).filter(Boolean) ?? [];
  const ownersDisplay =
    owners.length > 0 ? owners.join(", ") : "— (none; add operator Slack user ids—registry channels do not use a global CEO fallback)";

  const reactionsOn = channel.general_auto_reaction_enabled ?? false;
  const oooOn = channel.out_of_office_enabled ?? false;

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch" aria-label="Channel registry and controls">
      <div className="rounded-lg border border-border/80 bg-muted/20 p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <MetaPill label="Channel" value={title} />
          <MetaPill label="Channel ID" value={channel.channel_id} />
          {channel.company_slug?.trim() ? <MetaPill label="Company slug" value={channel.company_slug.trim()} /> : null}
          {channel.display_name?.trim() ? <MetaPill label="Display name" value={channel.display_name.trim()} /> : null}
          <MetaPill label="Owners" value={ownersDisplay} />
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-lg border border-border bg-background p-4 shadow-sm">
        {readOnly ? (
          <div className="divide-y divide-border">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <span className="text-sm font-medium text-foreground">Reactions</span>
              <span className="text-sm text-muted-foreground">{reactionsOn ? "On" : "Off"}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
              <span className="text-sm font-medium text-foreground">Out Of Office</span>
              <span className="text-sm text-muted-foreground">{oooOn ? "On" : "Off"}</span>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <span className="text-sm font-medium text-foreground">Reactions</span>
              <ControlToggle
                enabled={reactionsOn}
                disabled={false}
                busy={busy}
                onToggle={() => void patchChannel({ general_auto_reaction_enabled: !reactionsOn })}
                ariaLabel={reactionsOn ? "Turn off reactions" : "Turn on reactions"}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
              <span className="text-sm font-medium text-foreground">Out Of Office</span>
              <ControlToggle
                enabled={oooOn}
                disabled={false}
                busy={busy}
                onToggle={() => void patchChannel({ out_of_office_enabled: !oooOn })}
                ariaLabel={oooOn ? "Turn off out of office" : "Turn on out of office"}
              />
            </div>
          </div>
        )}
        {patchError ? <p className="mt-2 text-sm text-destructive">{patchError}</p> : null}
      </div>
    </section>
  );
}

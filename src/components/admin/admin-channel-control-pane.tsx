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
  onChannelUpdated: (ch: CompanyChannel) => void;
};

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function ReactionToggle({
  enabled,
  disabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy}
      disabled={disabled || busy}
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
      <span className="sr-only">{enabled ? "Disable" : "Enable"} CEO reaction mirror in #general</span>
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
}: AdminChannelControlPaneProps) {
  const [patchError, setPatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patchReactions = useCallback(
    async (next: boolean) => {
      if (!channel) return;
      setPatchError(null);
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/company-channels/${encodeURIComponent(channelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ general_auto_reaction_enabled: next }),
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
    [channel, channelId, onChannelUpdated],
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
        <h2 className="text-base font-semibold tracking-tight">Channel control pane</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This Slack channel id is not in the company registry ({redisKey ?? "employee-factory:company_channels"}). Toggles
          apply only to registered company channels.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{channelId}</p>
      </section>
    );
  }

  const title = channelDisplayTitle(channel);
  const operators = channel.allowed_operator_ids ?? [];

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm" aria-labelledby="channel-control-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="channel-control-heading" className="text-base font-semibold tracking-tight">
            Channel control pane
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registry metadata and runtime flags (stored in Redis; employee-factory picks them up on refresh).
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-2.5 border-t border-border pt-3">
        <MetaRow label="Channel" value={title} />
        <MetaRow label="Channel ID" value={channel.channel_id} />
        {channel.company_slug?.trim() ? <MetaRow label="Company slug" value={channel.company_slug.trim()} /> : null}
        {channel.display_name?.trim() ? <MetaRow label="Display name" value={channel.display_name.trim()} /> : null}
        <MetaRow label="Thread routing" value={channel.threads_enabled ? "On (company channel)" : "Off"} />
        {channel.primary_owner?.trim() ? <MetaRow label="Primary owner" value={channel.primary_owner.trim()} /> : null}
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
          <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Operators</dt>
          <dd className="min-w-0 flex-1">
            {operators.length > 0 ? (
              <ul className="space-y-1">
                {operators.map((id) => (
                  <li key={id} className="font-mono text-sm">
                    {id}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-muted-foreground">— (falls back to CEO operator id from runtime)</span>
            )}
          </dd>
        </div>
        {redisKey?.trim() ? (
          <MetaRow label="Redis hash" value={redisKey.trim()} />
        ) : null}
      </dl>

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium leading-tight">CEO reaction mirror (#general)</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When on, the bot mirrors the CEO&apos;s emoji reactions on bot messages in the main channel.
            </p>
          </div>
          <ReactionToggle
            enabled={channel.general_auto_reaction_enabled}
            disabled={false}
            busy={busy}
            onToggle={() => void patchReactions(!channel.general_auto_reaction_enabled)}
          />
        </div>
        {patchError ? <p className="mt-2 text-sm text-destructive">{patchError}</p> : null}
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type SlackChannel = {
  channelId: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  numMembers?: number;
};

type SlackMember = {
  slackUserId: string;
  username?: string;
  realName?: string;
  displayName?: string;
  email?: string;
  profileImageUrl?: string;
  isBot?: boolean;
  isDeleted?: boolean;
};

type ChannelsResponse = {
  fetchedAt?: string;
  channels?: SlackChannel[];
  error?: string;
};

type MembersResponse = {
  fetchedAt?: string;
  channelId?: string;
  members?: SlackMember[];
  error?: string;
};

function memberDisplayName(m: SlackMember): string {
  return (
    (m.realName && m.realName.trim()) ||
    (m.displayName && m.displayName.trim()) ||
    (m.username && m.username.trim()) ||
    m.slackUserId
  );
}

export function AdminChannelsStrip() {
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [membersByChannel, setMembersByChannel] = useState<Record<string, SlackMember[] | undefined>>({});
  const [membersErrorByChannel, setMembersErrorByChannel] = useState<Record<string, string | undefined>>({});
  const [membersLoadingByChannel, setMembersLoadingByChannel] = useState<Record<string, boolean | undefined>>({});

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch("/api/admin/channels", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as ChannelsResponse | null;
      if (!res.ok) {
        setChannelsError(payload?.error || `channels load failed (${res.status})`);
        setChannels([]);
        return;
      }
      setChannels(payload?.channels ?? []);
    } catch (e) {
      setChannelsError(e instanceof Error ? e.message : String(e));
      setChannels([]);
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const loadMembers = useCallback(async (channelId: string) => {
    setMembersLoadingByChannel((m) => ({ ...m, [channelId]: true }));
    setMembersErrorByChannel((m) => ({ ...m, [channelId]: undefined }));
    try {
      const res = await fetch(`/api/admin/channel-members?channel_id=${encodeURIComponent(channelId)}`, {
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as MembersResponse | null;
      if (!res.ok) {
        setMembersErrorByChannel((m) => ({ ...m, [channelId]: payload?.error || `members load failed (${res.status})` }));
        setMembersByChannel((m) => ({ ...m, [channelId]: [] }));
        return;
      }
      setMembersByChannel((m) => ({ ...m, [channelId]: payload?.members ?? [] }));
    } catch (e) {
      setMembersErrorByChannel((m) => ({ ...m, [channelId]: e instanceof Error ? e.message : String(e) }));
      setMembersByChannel((m) => ({ ...m, [channelId]: [] }));
    } finally {
      setMembersLoadingByChannel((m) => ({ ...m, [channelId]: false }));
    }
  }, []);

  const toggleChannel = useCallback(
    (channelId: string) => {
      if (expandedChannelId === channelId) {
        setExpandedChannelId(null);
        return;
      }
      setExpandedChannelId(channelId);
      if (!membersByChannel[channelId] && !membersLoadingByChannel[channelId]) {
        void loadMembers(channelId);
      }
    },
    [expandedChannelId, membersByChannel, membersLoadingByChannel, loadMembers],
  );

  return (
    <section className="space-y-3" aria-labelledby="admin-channels-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-channels-heading" className="font-display text-xl font-semibold tracking-tight text-foreground">
          Channels
        </h2>
        <button
          type="button"
          onClick={loadChannels}
          disabled={channelsLoading}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground motion-colors hover:bg-muted disabled:opacity-60"
        >
          {channelsLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {channelsError ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{channelsError}</p>
      ) : null}
      {channels && channels.length === 0 && !channelsLoading ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          No channels. Joanne creates channels when invited via DM.
        </p>
      ) : null}
      <ul className="space-y-2">
        {(channels ?? []).map((c) => {
          const expanded = expandedChannelId === c.channelId;
          const members = membersByChannel[c.channelId];
          const membersError = membersErrorByChannel[c.channelId];
          const membersLoading = membersLoadingByChannel[c.channelId];
          return (
            <li key={c.channelId} className="rounded-md border border-border bg-background">
              <button
                type="button"
                onClick={() => toggleChannel(c.channelId)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left motion-colors hover:bg-muted"
                aria-expanded={expanded}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-sm text-foreground">
                    {c.isPrivate ? "🔒" : "#"} {c.name || c.channelId}
                  </span>
                  {c.isArchived ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      archived
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded ? (
                <div className="border-t border-border px-3 py-2">
                  {membersLoading ? <p className="text-sm text-muted-foreground">Loading members…</p> : null}
                  {membersError ? (
                    <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-sm text-red-800">{membersError}</p>
                  ) : null}
                  {!membersLoading && !membersError && members && members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members.</p>
                  ) : null}
                  {!membersLoading && members && members.length > 0 ? (
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {members.map((m) => (
                        <li key={m.slackUserId} className="flex items-center gap-2 text-sm">
                          {m.profileImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.profileImageUrl}
                              alt=""
                              className="h-6 w-6 shrink-0 rounded-full border border-border object-cover"
                            />
                          ) : (
                            <span className="inline-block h-6 w-6 shrink-0 rounded-full bg-muted" aria-hidden />
                          )}
                          <span className="min-w-0 truncate text-foreground">
                            {memberDisplayName(m)}
                            {m.isBot ? <span className="ml-1 text-[10px] uppercase text-muted-foreground">bot</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

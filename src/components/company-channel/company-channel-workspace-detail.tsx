"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminChannelControlPane, type AdminChannelFounder } from "@/components/admin/admin-channel-control-pane";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import type { SlackTranscriptAuthorLookup } from "@/components/admin/admin-channel-digest-views";
import { companyChannelWorkspaceTitle, type CompanyChannel } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

type LoadState = "idle" | "loading" | "error" | "ready";

export type CompanyChannelWorkspaceVariant = "admin" | "portal";

export type CompanyChannelWorkspaceDetailProps = {
  channelId: string;
  /** `admin`: MakeACompany admin session + `/api/admin/*`. `portal`: owner session + `/api/portal/*`. */
  variant: CompanyChannelWorkspaceVariant;
};

function looksSlackMemberId(s: string): boolean {
  return /^U[A-Z0-9]{8,}$/i.test(s.trim());
}

/**
 * Single company-channel workspace: metadata, toggles, transcript.
 * Used from `/admin/[channelId]` (admin-only) and `/[channelId]` (portal owners) — same UI, different auth + API prefix.
 */
export function CompanyChannelWorkspaceDetail({ channelId, variant }: CompanyChannelWorkspaceDetailProps) {
  const [state, setState] = useState<LoadState>("idle");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [channel, setChannel] = useState<CompanyChannel | null>(null);
  const [channelStatus, setChannelStatus] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [channelError, setChannelError] = useState<string | undefined>();
  const [redisKey, setRedisKey] = useState<string | undefined>();
  const [markdown, setMarkdown] = useState<string>("");
  const [knowledgeEmpty, setKnowledgeEmpty] = useState(false);
  const [slackAuthorLookup, setSlackAuthorLookup] = useState<SlackTranscriptAuthorLookup>({});

  const apiPrefix = variant === "admin" ? "admin" : "portal";
  const profilesUrl =
    variant === "admin" ? "/api/admin/slack-bot-author-profiles" : "/api/portal/slack-bot-author-profiles";

  const load = useCallback(async () => {
    setState("loading");
    setTranscriptError(null);
    setChannelStatus("loading");
    const enc = encodeURIComponent(channelId);

    try {
      const [chRes, knRes, profRes] = await Promise.all([
        fetch(`/api/${apiPrefix}/company-channels/${enc}`, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/channel-knowledge/${enc}`, { cache: "no-store" }),
        fetch(profilesUrl, { cache: "no-store" }),
      ]);

      const flow = variant === "admin" ? "admin" : "portal";
      if (
        kickToLoginForUnauthorizedApi(chRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(knRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(profRes.status, flow, channelId)
      ) {
        return;
      }

      const chPayload = (await chRes.json().catch(() => null)) as
        | { channel?: CompanyChannel; redisKey?: string; error?: string }
        | null;
      const knPayload = (await knRes.json().catch(() => null)) as
        | { markdown?: string; empty?: boolean; error?: string }
        | null;

      if (chRes.status === 404) {
        setChannel(null);
        setChannelStatus("missing");
        setRedisKey(typeof chPayload?.redisKey === "string" ? chPayload.redisKey : undefined);
      } else if (!chRes.ok || !chPayload?.channel) {
        setChannel(null);
        setChannelStatus("error");
        setChannelError(chPayload?.error ?? "Could not load channel metadata.");
      } else {
        setChannel(chPayload.channel);
        setChannelStatus("ready");
        setRedisKey(typeof chPayload?.redisKey === "string" ? chPayload.redisKey : undefined);
      }

      if (!knRes.ok) {
        setMarkdown("");
        setKnowledgeEmpty(false);
        setTranscriptError(knPayload?.error ?? "Could not load channel transcript.");
      } else {
        const md = typeof knPayload?.markdown === "string" ? knPayload.markdown : "";
        setMarkdown(md);
        setKnowledgeEmpty(Boolean(knPayload?.empty) || md.trim() === "");
        setTranscriptError(null);
      }

      const nextLookup: SlackTranscriptAuthorLookup = {};
      if (profRes.ok) {
        const profJson = (await profRes.json().catch(() => null)) as {
          profiles?: Array<{ slackUserId?: string; displayName?: string; portraitUrl?: string }>;
        } | null;
        const rows = profJson?.profiles;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const sid = String(row.slackUserId ?? "").trim().toUpperCase();
            if (!sid) {
              continue;
            }
            nextLookup[sid] = {
              displayName: String(row.displayName ?? "").trim() || sid,
              portraitUrl: String(row.portraitUrl ?? "").trim(),
            };
          }
        }
      }
      setSlackAuthorLookup(nextLookup);

      setState("ready");
    } catch {
      setState("error");
      setSlackAuthorLookup({});
      setTranscriptError("Network error loading transcript.");
      setChannelStatus("error");
      setChannelError("Network error.");
    }
  }, [apiPrefix, channelId, profilesUrl, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageTitle =
    channel && channelStatus === "ready" ? companyChannelWorkspaceTitle(channel) : channelId;
  const workspaceChannelId = (channel?.channel_id ?? channelId).trim().toUpperCase();

  const foundersForHeader = useMemo((): AdminChannelFounder[] | undefined => {
    if (channelStatus !== "ready" || !channel) return undefined;
    const ids = channel.owner_ids?.map((id) => id.trim()).filter(Boolean) ?? [];
    return ids.map((id) => {
      const up = id.toUpperCase();
      const lu = slackAuthorLookup[up];
      const raw = lu?.displayName?.trim() ?? "";
      const isPlaceholder = !raw || looksSlackMemberId(raw) || raw.toUpperCase() === up;
      return {
        displayName: isPlaceholder ? "Member" : raw,
        portraitUrl: lu?.portraitUrl?.trim() || undefined,
      };
    });
  }, [channel, channelStatus, slackAuthorLookup]);

  if (state === "loading" || state === "idle") {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center py-12"
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2
          className="size-20 animate-spin text-black/25 sm:size-24"
          strokeWidth={0.55}
          aria-hidden
        />
        <p className="sr-only">Loading channel workspace</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8">
      {transcriptError ? <p className="text-sm text-destructive">{transcriptError}</p> : null}

      <AdminChannelControlPane
        channelId={channelId}
        channel={channel}
        status={channelStatus}
        errorMessage={channelError}
        redisKey={redisKey}
        onChannelUpdated={setChannel}
        companyChannelsApiPrefix={variant === "portal" ? "portal" : "admin"}
        workspaceTitle={pageTitle}
        workspaceChannelId={workspaceChannelId}
        founders={foundersForHeader}
      />

      {knowledgeEmpty && state === "ready" && !transcriptError ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-5 shadow-sm">
          <p className="text-sm text-muted-foreground">No channel knowledge digest in Redis yet for this channel.</p>
        </div>
      ) : null}
      {!knowledgeEmpty && markdown.trim() ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AdminChannelKnowledgeDigest markdown={markdown} slackAuthorLookup={slackAuthorLookup} />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AdminChannelControlPane } from "@/components/admin/admin-channel-control-pane";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import type { SlackTranscriptAuthorLookup } from "@/components/admin/admin-channel-digest-views";
import { channelDisplayTitle, type CompanyChannel } from "@/lib/admin/company-channels";

type LoadState = "idle" | "loading" | "error" | "ready";

export type CompanyChannelWorkspaceVariant = "admin" | "portal";

export type CompanyChannelWorkspaceDetailProps = {
  channelId: string;
  /** `admin`: MakeACompany admin session + `/api/admin/*`. `portal`: owner session + `/api/portal/*`. */
  variant: CompanyChannelWorkspaceVariant;
  backNav: { href: string; label: string };
};

/**
 * Single company-channel workspace: metadata, toggles, transcript.
 * Used from `/admin/[channelId]` (admin-only) and `/[channelId]` (portal owners) — same UI, different auth + API prefix.
 */
export function CompanyChannelWorkspaceDetail({
  channelId,
  variant,
  backNav,
}: CompanyChannelWorkspaceDetailProps) {
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
    const unauthorizedKnowledge =
      variant === "admin"
        ? "Unauthorized loading transcript. Check admin session."
        : "Unauthorized loading transcript. Sign in again from the company login page.";

    try {
      const [chRes, knRes, profRes] = await Promise.all([
        fetch(`/api/${apiPrefix}/company-channels/${enc}`, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/channel-knowledge/${enc}`, { cache: "no-store" }),
        fetch(profilesUrl, { cache: "no-store" }),
      ]);

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
        setTranscriptError(
          knRes.status === 401 ? unauthorizedKnowledge : (knPayload?.error ?? "Could not load channel transcript."),
        );
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

  const title =
    channel && channelStatus === "ready" ? channelDisplayTitle(channel) : channelId;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={backNav.href}
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {backNav.label}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      </div>

      {state === "loading" || state === "idle" ? (
        <p className="text-sm text-muted-foreground">Loading channel…</p>
      ) : null}
      {transcriptError ? <p className="text-sm text-destructive">{transcriptError}</p> : null}

      <AdminChannelControlPane
        channelId={channelId}
        channel={channel}
        status={channelStatus}
        errorMessage={channelError}
        redisKey={redisKey}
        onChannelUpdated={setChannel}
        companyChannelsApiPrefix={variant === "portal" ? "portal" : "admin"}
      />

      {knowledgeEmpty && state === "ready" && !transcriptError ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-muted/20 px-4 py-3">
            <h2 className="text-base font-semibold tracking-tight">Transcript</h2>
          </div>
          <p className="px-4 py-5 text-sm text-muted-foreground">
            No channel knowledge digest in Redis yet for this channel.
          </p>
        </div>
      ) : null}
      {!knowledgeEmpty && markdown.trim() ? (
        <AdminChannelKnowledgeDigest markdown={markdown} slackAuthorLookup={slackAuthorLookup} />
      ) : null}
    </div>
  );
}

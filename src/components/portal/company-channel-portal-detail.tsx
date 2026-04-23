"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminChannelControlPane } from "@/components/admin/admin-channel-control-pane";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import { channelDisplayTitle, type CompanyChannel } from "@/lib/admin/company-channels";

type LoadState = "idle" | "loading" | "error" | "ready";

type Props = {
  channelId: string;
};

export function CompanyChannelPortalDetail({ channelId }: Props) {
  const [state, setState] = useState<LoadState>("idle");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [channel, setChannel] = useState<CompanyChannel | null>(null);
  const [channelStatus, setChannelStatus] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [channelError, setChannelError] = useState<string | undefined>();
  const [redisKey, setRedisKey] = useState<string | undefined>();
  const [markdown, setMarkdown] = useState<string>("");
  const [knowledgeEmpty, setKnowledgeEmpty] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setTranscriptError(null);
    setChannelStatus("loading");
    try {
      const enc = encodeURIComponent(channelId);
      const [chRes, knRes] = await Promise.all([
        fetch(`/api/portal/company-channels/${enc}`, { cache: "no-store" }),
        fetch(`/api/portal/channel-knowledge/${enc}`, { cache: "no-store" }),
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
        setRedisKey(typeof chPayload.redisKey === "string" ? chPayload.redisKey : undefined);
      }

      if (!knRes.ok) {
        setMarkdown("");
        setKnowledgeEmpty(false);
        setTranscriptError(
          knRes.status === 401
            ? "Unauthorized loading transcript. Sign in again from the company login page."
            : (knPayload?.error ?? "Could not load channel transcript."),
        );
      } else {
        const md = typeof knPayload?.markdown === "string" ? knPayload.markdown : "";
        setMarkdown(md);
        setKnowledgeEmpty(Boolean(knPayload?.empty) || md.trim() === "");
        setTranscriptError(null);
      }

      setState("ready");
    } catch {
      setState("error");
      setTranscriptError("Network error loading transcript.");
      setChannelStatus("error");
      setChannelError("Network error.");
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const title =
    channel && channelStatus === "ready" ? channelDisplayTitle(channel) : channelId;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Home
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
        companyChannelsApiPrefix="portal"
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
      {!knowledgeEmpty && markdown.trim() ? <AdminChannelKnowledgeDigest markdown={markdown} /> : null}
    </div>
  );
}

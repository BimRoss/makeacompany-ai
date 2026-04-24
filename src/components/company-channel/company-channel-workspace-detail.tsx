"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminChannelControlPane, type AdminChannelFounder } from "@/components/admin/admin-channel-control-pane";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import type { SlackTranscriptAuthorLookup } from "@/components/admin/admin-channel-digest-views";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";
import { CompanyChannelPulsecheck } from "@/components/company-channel/company-channel-pulsecheck";
import { PortalPostAuthWelcomeToast } from "@/components/portal/portal-post-auth-welcome-toast";
import { companyChannelWorkspaceTitle, type CompanyChannel } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { peekPortalWelcomeParam, stripPortalWelcomeParam } from "@/lib/portal-welcome-param";

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
type SlackProfileRow = {
  slackUserId?: string;
  displayName?: string;
  portraitUrl?: string;
  email?: string;
};

type SlackMemberChannelsPayload = {
  channels?: Array<{ channel_id?: string; is_private?: boolean }>;
};

function slackPrivateForChannelId(payload: SlackMemberChannelsPayload | null, cid: string): boolean | null {
  const list = payload?.channels;
  if (!Array.isArray(list)) {
    return null;
  }
  const up = cid.trim().toUpperCase();
  for (const row of list) {
    const id = String(row?.channel_id ?? "")
      .trim()
      .toUpperCase();
    if (id === up) {
      return Boolean(row?.is_private);
    }
  }
  return null;
}

export function CompanyChannelWorkspaceDetail({ channelId, variant }: CompanyChannelWorkspaceDetailProps) {
  const [state, setState] = useState<LoadState>("idle");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [channel, setChannel] = useState<CompanyChannel | null>(null);
  const [channelStatus, setChannelStatus] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [channelError, setChannelError] = useState<string | undefined>();
  const [redisKey, setRedisKey] = useState<string | undefined>();
  const [markdown, setMarkdown] = useState<string>("");
  const [companyPulsecheck, setCompanyPulsecheck] = useState<string>("");
  const [knowledgeEmpty, setKnowledgeEmpty] = useState(false);
  const [slackAuthorLookup, setSlackAuthorLookup] = useState<SlackTranscriptAuthorLookup>({});
  const [portalWelcome, setPortalWelcome] = useState<{ greeting: string; portraitUrl?: string } | null>(null);
  /** Resolved from orchestrator member-channels; null if unknown or not listed. */
  const [slackChannelIsPrivate, setSlackChannelIsPrivate] = useState<boolean | null>(null);

  const apiPrefix = variant === "admin" ? "admin" : "portal";
  const profilesUrl =
    variant === "admin" ? "/api/admin/slack-bot-author-profiles" : "/api/portal/slack-bot-author-profiles";

  const dismissPortalWelcome = useCallback(() => {
    setPortalWelcome(null);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setTranscriptError(null);
    setChannelStatus("loading");
    setSlackChannelIsPrivate(null);
    const enc = encodeURIComponent(channelId);
    const wantPortalWelcome = variant === "portal" && peekPortalWelcomeParam();
    const mePromise = wantPortalWelcome ? fetch("/api/portal/auth/me", { cache: "no-store" }) : null;

    try {
      const [chRes, knRes, profRes, slackMcRes] = await Promise.all([
        fetch(`/api/${apiPrefix}/company-channels/${enc}`, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/channel-knowledge/${enc}`, { cache: "no-store" }),
        fetch(profilesUrl, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/slack-member-channels`, { cache: "no-store" }),
      ]);
      const meRes = mePromise ? await mePromise : null;

      const flow = variant === "admin" ? "admin" : "portal";
      if (
        kickToLoginForUnauthorizedApi(chRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(knRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(profRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(slackMcRes.status, flow, channelId)
      ) {
        return;
      }

      const slackPayload = (await slackMcRes.json().catch(() => null)) as SlackMemberChannelsPayload | null;
      setSlackChannelIsPrivate(slackPrivateForChannelId(slackPayload, channelId));

      const chPayload = (await chRes.json().catch(() => null)) as
        | { channel?: CompanyChannel; redisKey?: string; error?: string }
        | null;
      const knPayload = (await knRes.json().catch(() => null)) as
        | {
            markdown?: string;
            empty?: boolean;
            error?: string;
            company_pulsecheck?: string;
            company_pulsecheck_empty?: boolean;
          }
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
        setCompanyPulsecheck("");
        setKnowledgeEmpty(false);
        setTranscriptError(knPayload?.error ?? "Could not load channel transcript.");
      } else {
        const md = typeof knPayload?.markdown === "string" ? knPayload.markdown : "";
        setMarkdown(md);
        setKnowledgeEmpty(Boolean(knPayload?.empty) || md.trim() === "");
        setTranscriptError(null);
        const pulse =
          typeof knPayload?.company_pulsecheck === "string" && !knPayload?.company_pulsecheck_empty
            ? knPayload.company_pulsecheck
            : "";
        setCompanyPulsecheck(pulse);
      }

      let profPayload: { profiles?: SlackProfileRow[] } | null = null;
      if (profRes.ok) {
        profPayload = (await profRes.json().catch(() => null)) as { profiles?: SlackProfileRow[] } | null;
      }

      const nextLookup: SlackTranscriptAuthorLookup = {};
      const rows = profPayload?.profiles;
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
      setSlackAuthorLookup(nextLookup);

      if (wantPortalWelcome) {
        stripPortalWelcomeParam();
        let greeting = "Welcome! You're signed in to your company workspace.";
        let portraitUrl: string | undefined;
        if (meRes?.ok) {
          const meJson = (await meRes.json().catch(() => null)) as { email?: string } | null;
          const sessionEmail = String(meJson?.email ?? "").trim().toLowerCase();
          if (sessionEmail && Array.isArray(rows)) {
            for (const row of rows) {
              const rowEmail = String(row.email ?? "").trim().toLowerCase();
              if (!rowEmail || rowEmail !== sessionEmail) {
                continue;
              }
              const displayName = String(row.displayName ?? "").trim();
              if (displayName) {
                greeting = `Welcome, ${displayName}!`;
                const pu = String(row.portraitUrl ?? "").trim();
                if (pu) {
                  portraitUrl = pu;
                }
              }
              break;
            }
          }
        }
        setPortalWelcome({ greeting, portraitUrl });
      }

      setState("ready");
    } catch {
      setState("error");
      setSlackAuthorLookup({});
      setSlackChannelIsPrivate(null);
      setCompanyPulsecheck("");
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
    return <CompanyChannelPageLoader srLabel="Loading channel workspace" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8">
      {variant === "portal" ? (
        <PortalPostAuthWelcomeToast welcome={portalWelcome} onDismiss={dismissPortalWelcome} />
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
        workspaceTitle={pageTitle}
        founders={foundersForHeader}
        slackChannelIsPrivate={slackChannelIsPrivate}
      />

      {state === "ready" && !transcriptError ? (
        <CompanyChannelPulsecheck markdown={companyPulsecheck} slackAuthorLookup={slackAuthorLookup} />
      ) : null}

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

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AdminChannelControlPane,
  type ChannelWorkspaceViewerChip,
} from "@/components/admin/admin-channel-control-pane";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import type { SlackTranscriptAuthorLookup } from "@/components/admin/admin-channel-digest-views";
import { CompanyChannelPageLoader } from "@/components/company-channel/company-channel-page-loader";
import { PortalPostAuthWelcomeToast } from "@/components/portal/portal-post-auth-welcome-toast";
import { companyChannelWorkspaceTitle, type CompanyChannel } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";
import { peekPortalWelcomeParam, stripPortalWelcomeParam } from "@/lib/portal-welcome-param";
import type { KnowledgeActivityTimeBin } from "@/lib/channel-knowledge-activity";
import {
  buildSessionViewerIdentity,
  type SlackProfileRowForIdentity,
  type SlackWorkspaceUserRowForIdentity,
} from "@/lib/session-viewer-identity";

type LoadState = "idle" | "loading" | "error" | "ready";

export type CompanyChannelWorkspaceVariant = "admin" | "portal";

export type CompanyChannelWorkspaceDetailProps = {
  channelId: string;
  /** `admin`: MakeACompany admin session + `/api/admin/*`. `portal`: owner session + `/api/portal/*`. */
  variant: CompanyChannelWorkspaceVariant;
};

/**
 * Single company-channel workspace: metadata, toggles, transcript.
 * Used from `/admin/[channelId]` (admin-only) and `/[channelId]` (portal owners) — same UI, different auth + API prefix.
 */

type SlackWorkspaceUserRow = SlackWorkspaceUserRowForIdentity;

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
  const [knowledgeEmpty, setKnowledgeEmpty] = useState(false);
  const [slackAuthorLookup, setSlackAuthorLookup] = useState<SlackTranscriptAuthorLookup>({});
  const [portalWelcome, setPortalWelcome] = useState<{ greeting: string; portraitUrl?: string } | null>(null);
  /** Resolved from orchestrator member-channels; null if unknown or not listed. */
  const [slackChannelIsPrivate, setSlackChannelIsPrivate] = useState<boolean | null>(null);
  /** Click a bar to pin; Knowledge Base stays on this bucket until unpinned (click again or Escape). */
  const [knowledgeActivityPinnedBin, setKnowledgeActivityPinnedBin] = useState<KnowledgeActivityTimeBin | null>(null);
  const knowledgeDigestActivityBin = knowledgeActivityPinnedBin;
  const [viewerNavbarIdentity, setViewerNavbarIdentity] = useState<ChannelWorkspaceViewerChip | null>(null);

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
    setViewerNavbarIdentity(null);
    const enc = encodeURIComponent(channelId);
    const wantPortalWelcome = variant === "portal" && peekPortalWelcomeParam();

    try {
      const [chRes, knRes, profRes, slackMcRes, meRes, slackUsersRes] = await Promise.all([
        fetch(`/api/${apiPrefix}/company-channels/${enc}`, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/channel-knowledge/${enc}`, { cache: "no-store" }),
        fetch(profilesUrl, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/slack-member-channels`, { cache: "no-store" }),
        fetch(`/api/${apiPrefix}/auth/me`, { cache: "no-store" }),
        variant === "admin"
          ? fetch("/api/admin/slack-workspace-users", { cache: "no-store" })
          : Promise.resolve(null as Response | null),
      ]);

      const flow = variant === "admin" ? "admin" : "portal";
      if (
        kickToLoginForUnauthorizedApi(chRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(knRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(profRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(slackMcRes.status, flow, channelId) ||
        kickToLoginForUnauthorizedApi(meRes.status, flow, channelId) ||
        (variant === "admin" &&
          slackUsersRes != null &&
          kickToLoginForUnauthorizedApi(slackUsersRes.status, flow, channelId))
      ) {
        return;
      }

      type AuthMePayload = { authenticated?: boolean; email?: string };
      const meJson = (await meRes.json().catch(() => null)) as AuthMePayload | null;
      const sessionEmail = String(meJson?.email ?? "").trim().toLowerCase();

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
        setKnowledgeEmpty(false);
        setTranscriptError(knPayload?.error ?? "Could not load channel transcript.");
      } else {
        const md = typeof knPayload?.markdown === "string" ? knPayload.markdown : "";
        setMarkdown(md);
        setKnowledgeEmpty(Boolean(knPayload?.empty) || md.trim() === "");
        setTranscriptError(null);
      }

      let profPayload: { profiles?: SlackProfileRowForIdentity[] } | null = null;
      if (profRes.ok) {
        profPayload = (await profRes.json().catch(() => null)) as { profiles?: SlackProfileRowForIdentity[] } | null;
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

      let slackWorkspaceUsers: SlackWorkspaceUserRow[] = [];
      if (variant === "admin" && slackUsersRes?.ok) {
        const su = (await slackUsersRes.json().catch(() => null)) as { users?: SlackWorkspaceUserRow[] } | null;
        slackWorkspaceUsers = Array.isArray(su?.users) ? su.users : [];
      }

      const workspaceUserForSession =
        sessionEmail && variant === "admin" && slackWorkspaceUsers.length > 0
          ? slackWorkspaceUsers.find((u) => String(u.email ?? "").trim().toLowerCase() === sessionEmail)
          : undefined;

      let viewerChip: ChannelWorkspaceViewerChip | null = null;
      if (sessionEmail) {
        viewerChip = buildSessionViewerIdentity(sessionEmail, {
          profileRows: rows,
          workspaceUser: workspaceUserForSession,
        });
      }
      setViewerNavbarIdentity(viewerChip);
      setSlackAuthorLookup(nextLookup);

      if (wantPortalWelcome) {
        stripPortalWelcomeParam();
        const welcomeIdentity = sessionEmail
          ? buildSessionViewerIdentity(sessionEmail, {
              profileRows: rows,
              workspaceUser: workspaceUserForSession,
            })
          : null;
        const greeting = welcomeIdentity
          ? `Welcome, ${welcomeIdentity.displayName}!`
          : "Welcome! You're signed in to your company workspace.";
        setPortalWelcome({
          greeting,
          portraitUrl: welcomeIdentity?.portraitUrl,
        });
      }

      setState("ready");
    } catch {
      setState("error");
      setSlackAuthorLookup({});
      setSlackChannelIsPrivate(null);
      setViewerNavbarIdentity(null);
      setTranscriptError("Network error loading transcript.");
      setChannelStatus("error");
      setChannelError("Network error.");
    }
  }, [apiPrefix, channelId, profilesUrl, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!knowledgeActivityPinnedBin) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setKnowledgeActivityPinnedBin(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [knowledgeActivityPinnedBin]);

  const pageTitle =
    channel && channelStatus === "ready" ? companyChannelWorkspaceTitle(channel) : channelId;

  if (state === "loading" || state === "idle") {
    return <CompanyChannelPageLoader srLabel="Loading channel workspace" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8">
      {variant === "portal" ? (
        <PortalPostAuthWelcomeToast welcome={portalWelcome} onDismiss={dismissPortalWelcome} />
      ) : null}
      {transcriptError ? <p className="text-sm text-destructive">{transcriptError}</p> : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <AdminChannelControlPane
          channelId={channelId}
          channel={channel}
          status={channelStatus}
          errorMessage={channelError}
          redisKey={redisKey}
          onChannelUpdated={setChannel}
          companyChannelsApiPrefix={variant === "portal" ? "portal" : "admin"}
          workspaceTitle={pageTitle}
          viewerNavbarIdentity={viewerNavbarIdentity}
          knowledgeMarkdown={markdown}
          knowledgeActivityPinnedBin={knowledgeActivityPinnedBin}
          onKnowledgeActivityPinnedBinChange={setKnowledgeActivityPinnedBin}
          slackChannelIsPrivate={slackChannelIsPrivate}
        />

        {knowledgeEmpty && state === "ready" && !transcriptError ? (
          <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-card px-4 py-5 shadow-sm">
            <p className="text-sm text-muted-foreground">No channel knowledge digest in Redis yet for this channel.</p>
          </div>
        ) : null}
        {!knowledgeEmpty && markdown.trim() ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AdminChannelKnowledgeDigest
              markdown={markdown}
              slackAuthorLookup={slackAuthorLookup}
              activityTimeBinFilter={knowledgeDigestActivityBin}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

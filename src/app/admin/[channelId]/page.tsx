"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import { AdminShell } from "@/components/admin/admin-shell";
import { channelDisplayTitle, type CompanyChannelsResponse } from "@/lib/admin/company-channels";
import type { ChannelKnowledgeResponse } from "@/lib/admin/channel-knowledge";

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ChannelKnowledgeResponse };

export default function AdminChannelKnowledgePage() {
  const params = useParams();
  const rawId = typeof params?.channelId === "string" ? params.channelId : "";
  const channelId = decodeURIComponent(rawId);

  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [pageTitle, setPageTitle] = useState<string>("");

  useEffect(() => {
    setPageTitle("");
  }, [channelId]);

  const load = useCallback(async () => {
    if (!channelId) {
      setState({ kind: "error", message: "Missing channel id." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const [knowledgeRes, channelsRes] = await Promise.all([
        fetch(`/api/admin/channel-knowledge/${encodeURIComponent(channelId)}`, { cache: "no-store" }),
        fetch("/api/admin/company-channels", { cache: "no-store" }),
      ]);
      const payload = (await knowledgeRes.json().catch(() => null)) as ChannelKnowledgeResponse & { error?: string };
      const channelsPayload = (await channelsRes.json().catch(() => null)) as CompanyChannelsResponse | null;

      if (channelsRes.ok && channelsPayload?.channels) {
        const match = channelsPayload.channels.find((c) => c.channel_id === channelId);
        setPageTitle(match ? channelDisplayTitle(match) : channelId);
      } else {
        setPageTitle(channelId);
      }

      if (knowledgeRes.status === 401) {
        setState({ kind: "error", message: "Session expired or unauthorized. Sign in again from the admin home page." });
        return;
      }
      if (!knowledgeRes.ok || !payload || typeof payload.markdown !== "string") {
        setState({
          kind: "error",
          message: payload?.error ?? "Failed to load channel knowledge.",
        });
        return;
      }
      setState({ kind: "ready", data: payload });
    } catch {
      setState({ kind: "error", message: "Failed to load channel knowledge." });
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pageTitle) return;
    const prev = document.title;
    document.title = `${pageTitle} · Admin · makeacompany.ai`;
    return () => {
      document.title = prev;
    };
  }, [pageTitle]);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              <Link href="/admin" className="text-foreground underline-offset-4 hover:underline">
                ← Admin
              </Link>
            </p>
            {pageTitle ? (
              <h1 className="mt-2 text-xl font-semibold tracking-tight">{pageTitle}</h1>
            ) : null}
          </div>
        </div>

        {state.kind === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading digest from Redis…</p>
        ) : null}
        {state.kind === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : null}
        {state.kind === "ready" && state.data.empty ? (
          <p className="text-sm text-muted-foreground">
            No digest stored yet for this channel. It appears after the hourly channel-knowledge refresh job runs.
          </p>
        ) : null}
        {state.kind === "ready" && !state.data.empty ? (
          <AdminChannelKnowledgeDigest key={channelId || "channel"} markdown={state.data.markdown} />
        ) : null}
      </div>
    </AdminShell>
  );
}

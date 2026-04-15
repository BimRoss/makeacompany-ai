"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminChannelControlPane } from "@/components/admin/admin-channel-control-pane";
import { AdminCapabilityRoutingPanel } from "@/components/admin/admin-capability-routing-panel";
import { AdminChannelKnowledgeDigest } from "@/components/admin/admin-channel-knowledge-digest";
import { AdminShell } from "@/components/admin/admin-shell";
import { channelDisplayTitle, type CompanyChannel } from "@/lib/admin/company-channels";
import type { ChannelKnowledgeResponse } from "@/lib/admin/channel-knowledge";

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ChannelKnowledgeResponse };

type ChannelRegistryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing"; redisKey?: string }
  | { kind: "ready"; channel: CompanyChannel; redisKey?: string };

export default function AdminChannelKnowledgePage() {
  const params = useParams();
  const rawId = typeof params?.channelId === "string" ? params.channelId : "";
  const channelId = decodeURIComponent(rawId);

  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [registry, setRegistry] = useState<ChannelRegistryState>({ kind: "loading" });
  const [pageTitle, setPageTitle] = useState<string>("");

  useEffect(() => {
    setPageTitle("");
  }, [channelId]);

  const load = useCallback(async () => {
    if (!channelId) {
      setState({ kind: "error", message: "Missing channel id." });
      setRegistry({ kind: "error", message: "Missing channel id." });
      return;
    }
    setState({ kind: "loading" });
    setRegistry({ kind: "loading" });
    try {
      const [knowledgeRes, channelRes] = await Promise.all([
        fetch(`/api/admin/channel-knowledge/${encodeURIComponent(channelId)}`, { cache: "no-store" }),
        fetch(`/api/admin/company-channels/${encodeURIComponent(channelId)}`, { cache: "no-store" }),
      ]);
      const payload = (await knowledgeRes.json().catch(() => null)) as ChannelKnowledgeResponse & { error?: string };
      const channelPayload = (await channelRes.json().catch(() => null)) as
        | { channel?: CompanyChannel; redisKey?: string; error?: string }
        | null;

      if (channelRes.ok && channelPayload?.channel) {
        setRegistry({
          kind: "ready",
          channel: channelPayload.channel,
          redisKey: channelPayload.redisKey,
        });
        setPageTitle(channelDisplayTitle(channelPayload.channel));
      } else if (channelRes.status === 404) {
        setRegistry({ kind: "missing", redisKey: channelPayload?.redisKey });
        setPageTitle(channelId);
      } else {
        setRegistry({
          kind: "error",
          message: channelPayload?.error ?? "Failed to load channel registry.",
        });
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
      setRegistry({ kind: "error", message: "Failed to load channel registry." });
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

  const paneStatus =
    registry.kind === "loading"
      ? "loading"
      : registry.kind === "missing"
        ? "missing"
        : registry.kind === "error"
          ? "error"
          : "ready";

  return (
    <AdminShell>
      <div className="space-y-4 pt-6 sm:pt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {pageTitle ? (
              <h1 className="text-xl font-semibold tracking-tight">{pageTitle}</h1>
            ) : null}
          </div>
        </div>

        <AdminChannelControlPane
          channelId={channelId}
          channel={registry.kind === "ready" ? registry.channel : null}
          status={paneStatus}
          errorMessage={registry.kind === "error" ? registry.message : undefined}
          redisKey={registry.kind === "ready" ? registry.redisKey : registry.kind === "missing" ? registry.redisKey : undefined}
          onChannelUpdated={(ch) => {
            setRegistry((prev) => {
              const rk = prev.kind === "ready" ? prev.redisKey : undefined;
              return { kind: "ready", channel: ch, redisKey: rk };
            });
            setPageTitle(channelDisplayTitle(ch));
          }}
        />

        <AdminCapabilityRoutingPanel channelId={channelId} />

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

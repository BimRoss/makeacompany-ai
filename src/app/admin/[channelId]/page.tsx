"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AdminShell } from "@/components/admin/admin-shell";
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

  const load = useCallback(async () => {
    if (!channelId) {
      setState({ kind: "error", message: "Missing channel id." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/admin/channel-knowledge/${encodeURIComponent(channelId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ChannelKnowledgeResponse & { error?: string };
      if (response.status === 401) {
        setState({ kind: "error", message: "Session expired or unauthorized. Sign in again from the admin home page." });
        return;
      }
      if (!response.ok || !payload || typeof payload.markdown !== "string") {
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
            <h1 className="mt-2 text-xl font-semibold tracking-tight">Channel knowledge</h1>
            <p className="mt-1 font-mono text-[12px] text-muted-foreground">{channelId || "—"}</p>
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
          <article
            className="rounded-lg border border-border bg-card px-4 py-5 shadow-sm [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_li]:my-1 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
          >
            <ReactMarkdown>{state.data.markdown}</ReactMarkdown>
          </article>
        ) : null}
      </div>
    </AdminShell>
  );
}

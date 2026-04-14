"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CompanyChannel, CompanyChannelsResponse } from "@/lib/admin/company-channels";

type LoadState = "idle" | "loading" | "error" | "ready";

function channelTitle(ch: CompanyChannel): string {
  const slug = ch.company_slug?.trim();
  if (slug) return `#${slug.toLowerCase()}`;
  const dn = ch.display_name?.trim();
  if (dn) return dn;
  return ch.channel_id;
}

function pillClassName(emphasis: boolean): string {
  return emphasis
    ? "inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
    : "inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
}

export function AdminCompanyChannelsStrip() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState("");
  const [data, setData] = useState<CompanyChannelsResponse | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setStatusText("Loading companies…");
    try {
      const response = await fetch("/api/admin/company-channels", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CompanyChannelsResponse | null;
      if (!response.ok || !payload || !Array.isArray(payload.channels)) {
        setState("error");
        setStatusText("Failed to load company channels.");
        setData(null);
        return;
      }
      setData(payload);
      setState("ready");
      setStatusText("");
    } catch {
      setState("error");
      setStatusText("Failed to load company channels.");
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4 border-t border-border pt-8" aria-labelledby="admin-company-channels-heading">
      <h2 id="admin-company-channels-heading" className="text-lg font-semibold tracking-tight">
        Companies
      </h2>

      {state === "loading" || state === "idle" ? (
        <p className="text-sm text-muted-foreground">{statusText || "Loading…"}</p>
      ) : null}
      {state === "error" ? <p className="text-sm text-destructive">{statusText}</p> : null}

      {state === "ready" && data?.truncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          List truncated to the first 200 channels. Narrow the registry if needed.
        </p>
      ) : null}

      {state === "ready" && data && data.channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">No company channels in Redis yet.</p>
      ) : null}

      {state === "ready" && data && data.channels.length > 0 ? (
        <ul className="space-y-3">
          {data.channels.map((ch) => (
            <li key={ch.channel_id} className="list-none">
              <Link
                href={`/admin/${encodeURIComponent(ch.channel_id)}`}
                className="block rounded-lg border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium leading-tight">{channelTitle(ch)}</p>
                    {channelTitle(ch) !== ch.channel_id ? (
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{ch.channel_id}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ch.company_slug?.trim() ? (
                    <span className={pillClassName(false)} title="company_slug">
                      {ch.company_slug}
                    </span>
                  ) : null}
                  <span className={pillClassName(ch.general_auto_reaction_enabled)}>
                    {ch.general_auto_reaction_enabled ? "reactions on" : "reactions off"}
                  </span>
                  {ch.primary_owner?.trim() ? (
                    <span className={pillClassName(false)} title="primary_owner">
                      owner {ch.primary_owner}
                    </span>
                  ) : null}
                  {ch.allowed_operator_ids && ch.allowed_operator_ids.length > 0 ? (
                    <span className={pillClassName(false)} title="allowed_operator_ids">
                      {ch.allowed_operator_ids.length} operator
                      {ch.allowed_operator_ids.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

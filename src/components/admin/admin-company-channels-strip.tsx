"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { channelDisplayTitle, type CompanyChannel, type CompanyChannelsResponse } from "@/lib/admin/company-channels";

type LoadState = "idle" | "loading" | "error" | "ready";

type SlackMemberRow = {
  channel_id: string;
  name?: string;
  is_private?: boolean;
};

type SlackMemberPayload = {
  channels?: SlackMemberRow[];
  truncated?: boolean;
  error?: string;
  message?: string;
};

type MergedRow = {
  channel_id: string;
  slack_name: string;
  is_private: boolean;
  registry: CompanyChannel | null;
};

function pillClassName(emphasis: boolean): string {
  return emphasis
    ? "inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background"
    : "inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
}

function ownersPill(ch: CompanyChannel) {
  const owners = ch.owner_ids?.filter((id) => id.trim()) ?? [];
  if (owners.length === 0) {
    return (
      <span
        className={pillClassName(false)}
        title="Default policy: any human in the channel. Sync from Slack (discover) to persist owner_ids in Redis."
      >
        owners · any human
      </span>
    );
  }
  return (
    <span className={pillClassName(false)} title={owners.join(", ")}>
      {owners.length} human{owners.length === 1 ? "" : "s"} in channel
    </span>
  );
}

const maxDiscoverPolicySyncChannels = 25;

function needsRegistryPolicySync(row: MergedRow): boolean {
  if (!row.registry) return true;
  const owners = row.registry.owner_ids?.filter((id) => id.trim()) ?? [];
  if (owners.length === 0) return true;
  return false;
}

async function buildDiscoverChannelsFromSlack(rows: MergedRow[]): Promise<
  Array<{ channel_id: string; name: string; owner_ids: string[] }>
> {
  const slice = rows.slice(0, maxDiscoverPolicySyncChannels);
  const concurrency = 6;
  const out: Array<{ channel_id: string; name: string; owner_ids: string[] }> = [];
  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    const chunk = await Promise.all(
      batch.map(async (row) => {
        let owner_ids: string[] = [];
        try {
          const res = await fetch(
            `/api/admin/slack-channel-members?channel_id=${encodeURIComponent(row.channel_id)}`,
            { cache: "no-store" },
          );
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { human_user_ids?: string[] } | null;
            if (data && Array.isArray(data.human_user_ids)) {
              owner_ids = data.human_user_ids.filter((id) => typeof id === "string" && id.trim());
            }
          }
        } catch {
          /* keep owner_ids empty; upsert still fixes reactions */
        }
        return {
          channel_id: row.channel_id,
          name: row.slack_name,
          owner_ids,
        };
      }),
    );
    out.push(...chunk);
  }
  return out;
}

function cardTitle(row: MergedRow): string {
  if (row.registry) {
    return channelDisplayTitle(row.registry);
  }
  const n = row.slack_name.trim();
  return n.startsWith("#") ? n : `#${n}`;
}

export function AdminCompanyChannelsStrip() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState("");
  const [rows, setRows] = useState<MergedRow[]>([]);
  const [slackTruncated, setSlackTruncated] = useState(false);
  const [infoNote, setInfoNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setStatusText("Loading companies…");
    setInfoNote(null);
    try {
      const [slackRes, redisRes] = await Promise.all([
        fetch("/api/admin/slack-member-channels", { cache: "no-store" }),
        fetch("/api/admin/company-channels", { cache: "no-store" }),
      ]);

      const slackPayload = (await slackRes.json().catch(() => null)) as SlackMemberPayload | null;
      const redisPayload = (await redisRes.json().catch(() => null)) as
        | (CompanyChannelsResponse & { error?: string })
        | null;

      const registryById = new Map<string, CompanyChannel>();
      let redisError: string | null = null;
      if (redisRes.ok && redisPayload && Array.isArray(redisPayload.channels)) {
        for (const ch of redisPayload.channels) {
          const id = ch.channel_id?.trim();
          if (id) registryById.set(id, ch);
        }
      } else {
        const msg =
          typeof redisPayload?.error === "string"
            ? redisPayload.error
            : `Redis registry: HTTP ${redisRes.status}`;
        redisError = msg;
      }

      let merged: MergedRow[] = [];
      const seen = new Set<string>();

      if (slackRes.ok && slackPayload && Array.isArray(slackPayload.channels)) {
        setSlackTruncated(Boolean(slackPayload.truncated));
        for (const sc of slackPayload.channels) {
          const id = sc.channel_id?.trim();
          if (!id) continue;
          seen.add(id);
          const name = sc.name?.trim() || id;
          merged.push({
            channel_id: id,
            slack_name: name,
            is_private: Boolean(sc.is_private),
            registry: registryById.get(id) ?? null,
          });
        }
        merged.sort((a, b) =>
          a.slack_name.localeCompare(b.slack_name, undefined, { sensitivity: "base" }),
        );

        const forDiscover = merged.filter(needsRegistryPolicySync);
        if (forDiscover.length > 0 && !redisError) {
          try {
            if (forDiscover.length > maxDiscoverPolicySyncChannels) {
              setInfoNote((prev) =>
                [
                  prev,
                  `Policy sync runs for up to ${maxDiscoverPolicySyncChannels} channels per load (Slack member fetch). Refresh to cover more.`,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
            }
            const channels = await buildDiscoverChannelsFromSlack(forDiscover);
            const discoverRes = await fetch("/api/admin/company-channels/discover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channels }),
              cache: "no-store",
            });
            if (discoverRes.ok) {
              const redisRefresh = await fetch("/api/admin/company-channels", { cache: "no-store" });
              const refreshPayload = (await redisRefresh.json().catch(() => null)) as
                | (CompanyChannelsResponse & { error?: string })
                | null;
              if (redisRefresh.ok && refreshPayload && Array.isArray(refreshPayload.channels)) {
                const reg2 = new Map<string, CompanyChannel>();
                for (const ch of refreshPayload.channels) {
                  const id = ch.channel_id?.trim();
                  if (id) reg2.set(id, ch);
                }
                merged = merged.map((row) => ({
                  ...row,
                  registry: reg2.get(row.channel_id) ?? row.registry,
                }));
              }
            }
          } catch {
            /* keep merged rows as-is */
          }
        }
      } else {
        setSlackTruncated(false);
        let slackHint: string | null = null;
        if (!slackRes.ok && slackPayload) {
          if (slackRes.status === 503 && slackPayload.error === "not_configured") {
            slackHint =
              "Live Slack list skipped (set ORCHESTRATOR_DEBUG_BASE_URL like the Orchestrator log). Showing registry only.";
          } else if (slackPayload.message) {
            slackHint = `Slack list: ${slackPayload.message}`;
          } else if (slackPayload.error) {
            slackHint = `Slack list: ${slackPayload.error}`;
          }
        }
        if (slackHint) setInfoNote(slackHint);

        if (redisPayload && Array.isArray(redisPayload.channels)) {
          for (const ch of redisPayload.channels) {
            const id = ch.channel_id?.trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            merged.push({
              channel_id: id,
              slack_name: channelDisplayTitle(ch),
              is_private: false,
              registry: ch,
            });
          }
          merged.sort((a, b) =>
            cardTitle(a).localeCompare(cardTitle(b), undefined, { sensitivity: "base" }),
          );
        }
      }

      // Redis-only channels not returned by Slack (e.g. bot not invited yet)
      if (slackRes.ok && slackPayload && Array.isArray(slackPayload.channels)) {
        for (const [id, ch] of registryById) {
          if (seen.has(id)) continue;
          merged.push({
            channel_id: id,
            slack_name: channelDisplayTitle(ch),
            is_private: false,
            registry: ch,
          });
        }
        merged.sort((a, b) =>
          cardTitle(a).localeCompare(cardTitle(b), undefined, { sensitivity: "base" }),
        );
      }

      if (merged.length === 0) {
        const parts: string[] = [];
        if (redisError) parts.push(redisError);
        if (!slackRes.ok && slackPayload?.message) parts.push(slackPayload.message);
        setState("error");
        setStatusText(parts.filter(Boolean).join(" · ") || "Failed to load company channels.");
        setRows([]);
        return;
      }

      if (slackRes.ok && slackPayload && Array.isArray(slackPayload.channels) && redisError) {
        setInfoNote((prev) =>
          [prev, `Registry enrichment skipped: ${redisError}`].filter(Boolean).join(" "),
        );
      } else if (!slackRes.ok && redisError && merged.length > 0) {
        setInfoNote((prev) => [prev, redisError].filter(Boolean).join(" · "));
      }

      setRows(merged);
      setState("ready");
      setStatusText("");
    } catch {
      setState("error");
      setStatusText("Failed to load company channels.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      className="space-y-3 rounded-none bg-card px-0 py-3 sm:rounded-2xl sm:py-4"
      aria-labelledby="admin-company-channels-heading"
    >
      <h2 id="admin-company-channels-heading" className="text-lg font-semibold leading-snug tracking-tight">
        Companies
      </h2>

      {infoNote ? (
        <p className="text-sm text-muted-foreground" role="status">
          {infoNote}
        </p>
      ) : null}

      {state === "loading" || state === "idle" ? (
        <p className="text-sm text-muted-foreground">{statusText || "Loading…"}</p>
      ) : null}
      {state === "error" ? <p className="text-sm text-destructive">{statusText}</p> : null}

      {state === "ready" && slackTruncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Slack list truncated to the first 500 channels.
        </p>
      ) : null}

      {state === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No channels to show.</p>
      ) : null}

      {state === "ready" && rows.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.channel_id} className="list-none">
              <Link
                href={`/admin/company/${encodeURIComponent(row.channel_id)}`}
                className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-h-0 flex-1">
                  <p className="font-semibold leading-tight">{cardTitle(row)}</p>
                  {cardTitle(row) !== row.channel_id ? (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{row.channel_id}</p>
                  ) : null}
                  {row.is_private ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">Private channel</p>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {row.registry ? (
                    <>
                      {row.registry.company_slug?.trim() ? (
                        <span className={pillClassName(false)} title="company_slug">
                          {row.registry.company_slug}
                        </span>
                      ) : null}
                      <span className={pillClassName(!row.registry.general_responses_muted)}>
                        {!row.registry.general_responses_muted ? "general on" : "general off"}
                      </span>
                      <span className={pillClassName(row.registry.general_auto_reaction_enabled)}>
                        {row.registry.general_auto_reaction_enabled ? "reactions on" : "reactions off"}
                      </span>
                      {ownersPill(row.registry)}
                    </>
                  ) : (
                    <span className={pillClassName(false)} title="Not in employee-factory Redis registry yet">
                      not in registry
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

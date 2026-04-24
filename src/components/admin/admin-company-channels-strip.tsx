"use client";

import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlackPersonChip } from "@/components/admin/slack-person-chip";
import { channelDisplayTitle, type CompanyChannel, type CompanyChannelsResponse } from "@/lib/admin/company-channels";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

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

/** Labeled channel policy pills for the companies table (sentence case, no ALL CAPS). */
function settingsPillClassName(on: boolean): string {
  return on
    ? "inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium leading-none text-background"
    : "inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground";
}

function ChannelSettingsPills({ registry }: { registry: CompanyChannel | null }) {
  if (!registry) {
    return (
      <span className={settingsPillClassName(false)} title="Not in employee-factory Redis registry yet">
        —
      </span>
    );
  }
  const followUpOn = !registry.general_responses_muted;
  const reactionsOn = registry.general_auto_reaction_enabled;
  const oooOn = registry.out_of_office_enabled ?? false;
  return (
    <div className="flex min-w-0 max-w-[14rem] flex-wrap items-center gap-1">
      <span
        className={settingsPillClassName(followUpOn)}
        title="When on, agents may follow up on general messages and in threads. When off, only direct address."
      >
        follow up
      </span>
      <span
        className={settingsPillClassName(reactionsOn)}
        title="When on, sentiment thumbs and reaction mirroring are enabled."
      >
        reactions
      </span>
      {oooOn ? (
        <span className={settingsPillClassName(true)} title="Bots skip Socket Mode handling for this channel.">
          out of office
        </span>
      ) : null}
    </div>
  );
}

const maxDiscoverPolicySyncChannels = 25;

function looksSlackMemberId(s: string): boolean {
  return /^U[A-Z0-9]{8,}$/i.test(s.trim());
}

type SlackProfileEntry = {
  displayName: string;
  portraitUrl?: string;
};

function resolveHumanDisplayName(
  slackUserId: string,
  profileByUserId: Record<string, SlackProfileEntry>,
): string {
  const up = slackUserId.trim().toUpperCase();
  const lu = profileByUserId[up];
  const raw = lu?.displayName?.trim() ?? "";
  if (!raw || looksSlackMemberId(raw) || raw.toUpperCase() === up) {
    return "Member";
  }
  return raw;
}

function personChipProps(
  slackUserId: string,
  profileByUserId: Record<string, SlackProfileEntry>,
): { displayName: string; portraitUrl?: string } {
  const up = slackUserId.trim().toUpperCase();
  const lu = profileByUserId[up];
  const portrait = lu?.portraitUrl?.trim();
  return {
    displayName: resolveHumanDisplayName(slackUserId, profileByUserId),
    portraitUrl: portrait || undefined,
  };
}

type HumanPillData = {
  profileByUserId: Record<string, SlackProfileEntry>;
};

function needsRegistryPolicySync(row: MergedRow): boolean {
  if (!row.registry) return true;
  const owners = row.registry.owner_ids?.filter((id) => id.trim()) ?? [];
  if (owners.length === 0) return true;
  return false;
}

async function buildDiscoverChannelsFromSlack(rows: MergedRow[]): Promise<
  Array<{ channel_id: string; name: string; owner_ids: string[] }> | null
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
          if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
            return null;
          }
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
    if (chunk.some((c) => c === null)) {
      return null;
    }
    out.push(
      ...chunk.filter((c): c is { channel_id: string; name: string; owner_ids: string[] } => c !== null),
    );
  }
  return out;
}

async function loadSlackProfilesForPills(): Promise<Record<string, SlackProfileEntry> | null> {
  const res = await fetch("/api/admin/slack-bot-author-profiles", { cache: "no-store" });
  if (kickToLoginForUnauthorizedApi(res.status, "admin")) {
    return null;
  }
  if (!res.ok) {
    return {};
  }
  const payload = (await res.json().catch(() => null)) as
    | { profiles?: Array<{ slackUserId?: string; displayName?: string; portraitUrl?: string }> }
    | null;
  const out: Record<string, SlackProfileEntry> = {};
  for (const row of payload?.profiles ?? []) {
    const sid = String(row.slackUserId ?? "").trim().toUpperCase();
    if (!sid) continue;
    const dn = String(row.displayName ?? "").trim();
    const portraitUrl = String(row.portraitUrl ?? "").trim();
    out[sid] = { displayName: dn || sid, portraitUrl: portraitUrl || undefined };
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

function stripLeadingHash(title: string): string {
  return title.startsWith("#") ? title.slice(1) : title;
}

/** Preserve registry order, uppercase Slack ids, drop empties and duplicates. */
function uniqueNormalizedOwnerIds(ownerIds: string[] | undefined): string[] {
  if (!ownerIds?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ownerIds) {
    const u = raw.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function AdminCompanyChannelsStrip() {
  const [state, setState] = useState<LoadState>("idle");
  const [statusText, setStatusText] = useState("");
  const [rows, setRows] = useState<MergedRow[]>([]);
  const [humanPillData, setHumanPillData] = useState<HumanPillData>({
    profileByUserId: {},
  });
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [enrichBanner, setEnrichBanner] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const rowsRef = useRef<MergedRow[]>([]);
  rowsRef.current = rows;

  const load = useCallback(async (live: boolean) => {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;

    setSnapshotLoading(true);
    setEnrichBanner(null);
    if (!live) {
      setStatusText("");
    }
    const keepTableVisible = live && rowsRef.current.length > 0;
    if (!keepTableVisible) {
      setState("loading");
    }

    try {
      const slackQs = live ? "?source=live" : "";
      const slackRes = await fetch(`/api/admin/slack-member-channels${slackQs}`, { cache: "no-store" });
      if (stale()) return;
      if (kickToLoginForUnauthorizedApi(slackRes.status, "admin")) {
        setSnapshotLoading(false);
        setState("idle");
        return;
      }

      const slackPayload = (await slackRes.json().catch(() => null)) as SlackMemberPayload | null;

      // After a live Slack pull, drop registry rows that no longer appear in the orchestrator member list
      // (same idea as Stripe refresh replacing the snapshot). Skip when list is empty or truncated.
      if (live && slackRes.ok && slackPayload && Array.isArray(slackPayload.channels)) {
        const truncated = Boolean(slackPayload.truncated);
        const ids = slackPayload.channels
          .map((c) => (c.channel_id ?? "").trim())
          .filter((id) => id.length > 0);
        if (truncated && ids.length > 0) {
          setEnrichBanner(
            "Slack channel list was truncated; skipped pruning the Redis company registry to avoid deleting rows that were not returned.",
          );
        } else if (ids.length > 0) {
          try {
            const pruneRes = await fetch("/api/admin/company-channels/registry-prune", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keep_channel_ids: ids }),
              cache: "no-store",
            });
            if (kickToLoginForUnauthorizedApi(pruneRes.status, "admin")) {
              setSnapshotLoading(false);
              setState("idle");
              return;
            }
            if (!pruneRes.ok) {
              const errBody = (await pruneRes.json().catch(() => null)) as { error?: string } | null;
              setEnrichBanner(
                `Could not prune stale companies from Redis: ${typeof errBody?.error === "string" ? errBody.error : `HTTP ${pruneRes.status}`}`,
              );
            }
          } catch {
            setEnrichBanner("Could not prune stale companies from Redis (network error).");
          }
          if (stale()) return;
        }
      }

      if (stale()) return;

      const redisRes = await fetch("/api/admin/company-channels", { cache: "no-store" });
      if (stale()) return;
      if (kickToLoginForUnauthorizedApi(redisRes.status, "admin")) {
        setSnapshotLoading(false);
        setState("idle");
        return;
      }

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

      const merged: MergedRow[] = [];
      const seen = new Set<string>();

      if (slackRes.ok && slackPayload && Array.isArray(slackPayload.channels)) {
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
      } else {
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
        const slackEmpty =
          slackRes.ok &&
          slackPayload &&
          Array.isArray(slackPayload.channels) &&
          slackPayload.channels.length === 0;
        const hint =
          slackEmpty && !redisError
            ? "No Slack channels in the member snapshot and no rows in the company registry for this Redis. If you use docker compose, ensure employee-factory and makeacompany-ai share the same REDIS_URL (or run channel discover once)."
            : "";
        setState("error");
        setStatusText(
          [parts.filter(Boolean).join(" · "), hint].filter(Boolean).join(" ") ||
            "Failed to load company channels.",
        );
        setRows([]);
        setHumanPillData({ profileByUserId: {} });
        setSnapshotLoading(false);
        return;
      }

      // Phase 1: show table immediately (Slack snapshot + Redis registry merge only).
      setRows(merged);
      setState("ready");
      setStatusText("");
      if (!live) {
        setSnapshotLoading(false);
      }

      const slackOk = slackRes.ok && slackPayload && Array.isArray(slackPayload.channels);
      const snapshotMerged = merged;

      const runEnrichment = async () => {
        let working = snapshotMerged;

        if (slackOk && !redisError) {
          const forDiscover = working.filter(needsRegistryPolicySync);
          if (forDiscover.length > 0) {
            try {
              const channels = await buildDiscoverChannelsFromSlack(forDiscover);
              if (stale()) return;
              if (channels === null) {
                setEnrichBanner(
                  "Company policy sync was interrupted (session or Slack member fetch). Reload or sign in again; table shows the snapshot before sync.",
                );
              } else {
                const discoverRes = await fetch("/api/admin/company-channels/discover", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ channels }),
                  cache: "no-store",
                });
                if (kickToLoginForUnauthorizedApi(discoverRes.status, "admin")) {
                  return;
                }
                if (stale()) return;
                if (discoverRes.ok) {
                  const redisRefresh = await fetch("/api/admin/company-channels", { cache: "no-store" });
                  if (kickToLoginForUnauthorizedApi(redisRefresh.status, "admin")) {
                    return;
                  }
                  if (stale()) return;
                  const refreshPayload = (await redisRefresh.json().catch(() => null)) as
                    | (CompanyChannelsResponse & { error?: string })
                    | null;
                  if (redisRefresh.ok && refreshPayload && Array.isArray(refreshPayload.channels)) {
                    const reg2 = new Map<string, CompanyChannel>();
                    for (const ch of refreshPayload.channels) {
                      const id = ch.channel_id?.trim();
                      if (id) reg2.set(id, ch);
                    }
                    working = working.map((row) => ({
                      ...row,
                      registry: reg2.get(row.channel_id) ?? row.registry,
                    }));
                    if (!stale()) setRows(working);
                  }
                }
              }
            } catch {
              /* keep working rows as-is */
            }
          }
        }

        if (stale()) return;

        try {
          const profiles = await loadSlackProfilesForPills();
          if (stale()) return;
          if (profiles === null) {
            setEnrichBanner(
              (prev) =>
                prev ??
                "Could not load Slack profile names for founder chips (session). Table data is unchanged.",
            );
          } else {
            setHumanPillData({ profileByUserId: profiles });
          }
        } catch {
          /* keep existing profile map */
        }
      };

      if (live) {
        try {
          await runEnrichment();
        } finally {
          if (!stale()) {
            setSnapshotLoading(false);
          }
        }
      } else {
        void runEnrichment();
      }
    } catch {
      if (!stale()) {
        setState("error");
        setStatusText("Failed to load company channels.");
        setRows([]);
        setHumanPillData({ profileByUserId: {} });
        setSnapshotLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <section className="space-y-3" aria-labelledby="admin-company-channels-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-company-channels-heading" className="font-display text-xl font-semibold tracking-tight text-foreground">
          Companies{" "}
          <span className="font-normal text-muted-foreground tabular-nums">({rows.length})</span>
        </h2>
        <button
          type="button"
          disabled={snapshotLoading}
          aria-busy={snapshotLoading}
          onClick={() => void load(true)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {state === "error" ? <p className="text-sm text-destructive">{statusText}</p> : null}
      {enrichBanner && state !== "error" ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          {enrichBanner}
        </p>
      ) : null}

      {state === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No companies.</p>
      ) : null}

      {state !== "error" && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-1.5">Company</th>
                <th className="px-3 py-1.5">Channel ID</th>
                <th className="px-3 py-1.5">Visibility</th>
                <th className="px-3 py-1.5">Settings</th>
                <th className="px-3 py-1.5">Founders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { profileByUserId } = humanPillData;
                const founderIdsOrdered = row.registry
                  ? uniqueNormalizedOwnerIds(row.registry.owner_ids)
                  : [];
                const title = stripLeadingHash(cardTitle(row));

                return (
                  <tr key={row.channel_id} className="border-b border-border/80 last:border-0">
                    <td className="px-3 py-1.5 align-middle">
                      <Link
                        href={`/admin/${encodeURIComponent(row.channel_id)}`}
                        className="text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {title}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 align-middle font-mono text-xs text-muted-foreground tabular-nums">
                      {row.channel_id}
                    </td>
                    <td className="px-3 py-1.5 align-middle text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span title={row.is_private ? "Private channel" : "Public channel"} aria-hidden>
                          {row.is_private ? (
                            <Lock className="size-3 shrink-0" strokeWidth={2.25} />
                          ) : (
                            <Users className="size-3 shrink-0" strokeWidth={2.25} />
                          )}
                        </span>
                        {row.is_private ? "Private" : "Public"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <ChannelSettingsPills registry={row.registry} />
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      {founderIdsOrdered.length > 0 ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                          {founderIdsOrdered.map((sid) => (
                            <span key={`founder-${sid}`} title={`Slack user ${sid}`}>
                              <SlackPersonChip {...personChipProps(sid, profileByUserId)} />
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

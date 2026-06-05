"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MARKETING_DEFAULT_TARGET_URL,
  MARKETING_KEBAB_RE,
  MARKETING_MEDIUMS,
  MARKETING_SOURCES,
  type MarketingMedium,
  type MarketingSource,
} from "@/lib/marketing-taxonomy";

type Campaign = {
  id: string;
  campaign: string;
  source: string;
  medium: string;
  content?: string;
  target_url: string;
  tagged_url: string;
  created_by_email: string;
  created_at: string;
  created_at_ms: number;
};

type ListResponse = {
  campaigns?: Campaign[];
  error?: string;
};

type Props = {
  currentUserEmail: string;
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function MarketingRegistry({ currentUserEmail }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [source, setSource] = useState<MarketingSource>(MARKETING_SOURCES[0]);
  const [medium, setMedium] = useState<MarketingMedium>(MARKETING_MEDIUMS[0]);
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [targetURL, setTargetURL] = useState(MARKETING_DEFAULT_TARGET_URL);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<Campaign | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/marketing/campaigns", { cache: "no-store", signal });
      const body = (await res.json().catch(() => ({}))) as ListResponse;
      if (!res.ok) {
        setListError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setListError(null);
      setCampaigns(body.campaigns ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setListError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const previewURL = useMemo(() => {
    const trimmedTarget = targetURL.trim() || MARKETING_DEFAULT_TARGET_URL;
    if (!campaign || !MARKETING_KEBAB_RE.test(campaign)) return null;
    if (content && !MARKETING_KEBAB_RE.test(content)) return null;
    const sep = trimmedTarget.includes("?") ? "&" : "?";
    const parts = [
      `utm_source=${encodeURIComponent(source)}`,
      `utm_medium=${encodeURIComponent(medium)}`,
      `utm_campaign=${encodeURIComponent(campaign)}`,
    ];
    if (content) parts.push(`utm_content=${encodeURIComponent(content)}`);
    return `${trimmedTarget}${sep}${parts.join("&")}`;
  }, [campaign, content, medium, source, targetURL]);

  const campaignError = useMemo(() => {
    if (!campaign) return null;
    if (!MARKETING_KEBAB_RE.test(campaign)) {
      return "Lowercase kebab-case only (e.g. 2026-06-veo-ad)";
    }
    return null;
  }, [campaign]);

  const contentError = useMemo(() => {
    if (!content) return null;
    if (!MARKETING_KEBAB_RE.test(content)) {
      return "Lowercase kebab-case only";
    }
    return null;
  }, [content]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitError(null);
      if (!campaign || campaignError || contentError) {
        setSubmitError("Fix the highlighted fields before saving.");
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch("/api/marketing/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            campaign,
            source,
            medium,
            content: content || undefined,
            target_url: targetURL.trim() || MARKETING_DEFAULT_TARGET_URL,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as Campaign & { error?: string };
        if (!res.ok) {
          setSubmitError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setLastCreated(body);
        setCampaign("");
        setContent("");
        await refresh();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setSubmitting(false);
      }
    },
    [campaign, campaignError, content, contentError, medium, refresh, source, targetURL],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6">
        <header className="mb-4">
          <h1 className="text-xl font-semibold text-foreground">UTM registry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build a tagged URL, save it to the registry. Signed in as <code>{currentUserEmail}</code>.
          </p>
        </header>

        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Source</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as MarketingSource)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {MARKETING_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Medium</span>
            <select
              value={medium}
              onChange={(e) => setMedium(e.target.value as MarketingMedium)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {MARKETING_MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              Campaign <span className="text-muted-foreground">(required, lowercase kebab-case)</span>
            </span>
            <input
              required
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="2026-06-veo-ad"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              aria-invalid={campaignError ? true : undefined}
            />
            {campaignError ? <span className="text-xs text-rose-500">{campaignError}</span> : null}
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              Content <span className="text-muted-foreground">(optional, lowercase kebab-case)</span>
            </span>
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="post-hero-image"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              aria-invalid={contentError ? true : undefined}
            />
            {contentError ? <span className="text-xs text-rose-500">{contentError}</span> : null}
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">Target URL</span>
            <input
              value={targetURL}
              onChange={(e) => setTargetURL(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>

          <div className="sm:col-span-2 flex flex-col gap-2 rounded-md border border-dashed border-border bg-background/60 p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
            <code className="break-all text-xs text-foreground">
              {previewURL ?? "Fill in a valid campaign to preview the tagged URL."}
            </code>
          </div>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save campaign"}
            </button>
            {submitError ? <span className="text-sm text-rose-500">{submitError}</span> : null}
          </div>
        </form>

        {lastCreated ? (
          <div className="mt-4 flex flex-col gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">Saved.</span>
              <CopyButton value={lastCreated.tagged_url} label="Copy tagged URL" />
            </div>
            <code className="break-all text-xs text-foreground">{lastCreated.tagged_url}</code>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Registry</h2>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/40"
          >
            Refresh
          </button>
        </header>

        {listError ? (
          <p className="mb-3 text-sm text-rose-500">Could not load registry: {listError}</p>
        ) : null}

        {campaigns === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet. Save one above to start the log.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Campaign</th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Medium</th>
                  <th className="py-2 pr-4 font-medium">Tagged URL</th>
                  <th className="py-2 pr-4 font-medium">Created by</th>
                  <th className="py-2 pr-4 font-medium">Created at</th>
                  <th className="py-2 pr-0 font-medium" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 font-medium text-foreground">{c.campaign}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.source}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.medium}</td>
                    <td className="max-w-[420px] break-all py-2 pr-4 text-xs text-foreground">
                      {c.tagged_url}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.created_by_email}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatTimestamp(c.created_at)}</td>
                    <td className="py-2 pr-0">
                      <CopyButton value={c.tagged_url} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

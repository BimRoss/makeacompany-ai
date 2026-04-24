"use client";

import clsx from "clsx";
import { Search, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEventHandler } from "react";
import ReactMarkdown from "react-markdown";
import {
  DigestAuthorLookupProvider,
  DigestAuthorView,
  DigestThreadView,
  digestMarkdownForClassic,
  type SlackTranscriptAuthorLookup,
} from "@/components/admin/admin-channel-digest-views";
import { splitDigestMarkdown } from "@/lib/channel-digest-parse";
import {
  filterDigestMarkdownByActivityBin,
  filterDigestMarkdownBySearchQuery,
  type KnowledgeActivityTimeBin,
} from "@/lib/channel-knowledge-activity";

/** First paint: show the tail of the digest so recent channel activity is visible. */
const INITIAL_VISIBLE_LINES = 120;
/**
 * Author (kanban) columns are built from the visible slice only; a short tail can hide
 * infrequent posters. When switching to Author, widen to this many tail lines (cap for perf).
 */
const INITIAL_AUTHOR_KANBAN_LINES = 500;
/** Each time the user scrolls near the load edge, reveal this many older lines. */
const LOAD_MORE_LINES = 100;
/** Classic markdown: load older when near the top of the scroll container. */
const TOP_SCROLL_THRESHOLD_PX = 80;
/** Thread left column (newest at top): load older when near the bottom. */
const BOTTOM_SCROLL_THRESHOLD_PX = 80;

type DigestView = "classic" | "thread" | "author";

function tailStartIndex(bodyLines: string[]): number {
  const n = bodyLines.length;
  if (n <= INITIAL_VISIBLE_LINES) {
    return 0;
  }
  return Math.max(0, n - INITIAL_VISIBLE_LINES);
}

type PendingScrollAdjust = { prevHeight: number; prevTop: number };

export type AdminChannelKnowledgeDigestProps = {
  markdown: string;
  /** When set (from `/api/admin/slack-bot-author-profiles` or portal equivalent), transcript rows show names + Slack profile images for matching Slack user IDs. */
  slackAuthorLookup?: SlackTranscriptAuthorLookup | null;
  /** When set, only digest lines whose timestamps fall in this activity bucket are shown. */
  activityTimeBinFilter?: KnowledgeActivityTimeBin | null;
};

export function AdminChannelKnowledgeDigest({
  markdown,
  slackAuthorLookup,
  activityTimeBinFilter = null,
}: AdminChannelKnowledgeDigestProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const activityFilteredMarkdown = useMemo(
    () => filterDigestMarkdownByActivityBin(markdown, activityTimeBinFilter),
    [markdown, activityTimeBinFilter],
  );
  const effectiveMarkdown = useMemo(
    () => filterDigestMarkdownBySearchQuery(activityFilteredMarkdown, searchQuery, slackAuthorLookup ?? null),
    [activityFilteredMarkdown, searchQuery, slackAuthorLookup],
  );
  const { header, bodyLines } = useMemo(() => splitDigestMarkdown(effectiveMarkdown), [effectiveMarkdown]);
  const tailStart = useMemo(() => tailStartIndex(bodyLines), [bodyLines]);

  const [visibleStart, setVisibleStart] = useState(tailStart);
  const [view, setView] = useState<DigestView>("author");
  const prependingRef = useRef(false);
  const pendingScrollAdjustRef = useRef<PendingScrollAdjust | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);
  const prevViewRef = useRef<DigestView | null>(null);

  useLayoutEffect(() => {
    setVisibleStart(tailStart);
    prependingRef.current = false;
    pendingScrollAdjustRef.current = null;
    didInitialScrollRef.current = false;
  }, [tailStart]);

  useLayoutEffect(() => {
    didInitialScrollRef.current = false;
  }, [view]);

  useLayoutEffect(() => {
    didInitialScrollRef.current = false;
  }, [searchQuery, activityTimeBinFilter]);

  useLayoutEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (view !== "author" || prev === "author") {
      return;
    }
    const n = bodyLines.length;
    if (n <= INITIAL_AUTHOR_KANBAN_LINES) {
      setVisibleStart(0);
      return;
    }
    const authorTailStart = Math.max(0, n - INITIAL_AUTHOR_KANBAN_LINES);
    setVisibleStart((s) => Math.min(s, authorTailStart));
  }, [view, bodyLines]);

  const visibleBodyText = useMemo(() => bodyLines.slice(visibleStart).join("\n"), [bodyLines, visibleStart]);

  const visibleMarkdown = useMemo(() => {
    if (!header) {
      return visibleBodyText;
    }
    if (!visibleBodyText.trim()) {
      return header;
    }
    return `${header}\n\n${visibleBodyText}`;
  }, [header, visibleBodyText]);

  const classicSource = useMemo(() => digestMarkdownForClassic(visibleMarkdown), [visibleMarkdown]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScrollAdjustRef.current;
    if (el && pending) {
      el.scrollTop = pending.prevTop + (el.scrollHeight - pending.prevHeight);
      pendingScrollAdjustRef.current = null;
    }
    prependingRef.current = false;
  }, [visibleMarkdown, view]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScrollRef.current || !visibleMarkdown.trim()) {
      return;
    }
    // Thread view lists newest channel roots at the top; classic/author keep chronological tail at bottom.
    el.scrollTop = view === "thread" ? 0 : el.scrollHeight;
    didInitialScrollRef.current = true;
  }, [visibleMarkdown, view]);

  const tryPrependOlderDigestSlice = useCallback((scrollEl: HTMLElement | null): boolean => {
    if (prependingRef.current || visibleStart <= 0) {
      return false;
    }
    prependingRef.current = true;
    if (scrollEl) {
      pendingScrollAdjustRef.current = {
        prevHeight: scrollEl.scrollHeight,
        prevTop: scrollEl.scrollTop,
      };
    } else {
      pendingScrollAdjustRef.current = null;
    }
    setVisibleStart((s) => Math.max(0, s - LOAD_MORE_LINES));
    return true;
  }, [visibleStart]);

  const onThreadListScroll: UIEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const el = e.currentTarget;
      if (prependingRef.current || visibleStart <= 0) {
        return;
      }
      if (el.scrollTop + el.clientHeight < el.scrollHeight - BOTTOM_SCROLL_THRESHOLD_PX) {
        return;
      }
      tryPrependOlderDigestSlice(el);
    },
    [visibleStart, tryPrependOlderDigestSlice],
  );

  const onClassicScroll: UIEventHandler<HTMLDivElement> = useCallback(() => {
    const el = scrollRef.current;
    if (!el || prependingRef.current || visibleStart <= 0) {
      return;
    }
    if (el.scrollTop > TOP_SCROLL_THRESHOLD_PX) {
      return;
    }
    tryPrependOlderDigestSlice(el);
  }, [visibleStart, tryPrependOlderDigestSlice]);

  const viewBtn = (id: DigestView, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setView(id)}
      className={clsx(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        view === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-[42rem] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-3 py-2 sm:px-4">
        <div className="relative min-h-8 min-w-0 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages…"
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-background py-1 pl-8 pr-8 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search knowledge base"
            autoComplete="off"
            spellCheck={false}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
        <div
          className="inline-flex shrink-0 rounded-lg bg-muted/40 p-0.5"
          role="tablist"
          aria-label="Knowledge base view"
        >
          {viewBtn("author", "Employees")}
          {viewBtn("thread", "Messages")}
          {viewBtn("classic", "Markdown")}
        </div>
      </div>
      <div
        ref={view === "classic" ? scrollRef : undefined}
        onScroll={view === "classic" ? onClassicScroll : undefined}
        className={clsx(
          "flex min-h-0 min-w-0 flex-1 basis-0 flex-col items-stretch px-3 py-3 sm:px-4",
          view === "classic"
            ? "overflow-y-auto [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_li]:my-1 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
            : "overflow-hidden",
        )}
      >
        <DigestAuthorLookupProvider lookup={slackAuthorLookup}>
          {view === "classic" ? (
            <article>
              <ReactMarkdown>{classicSource}</ReactMarkdown>
            </article>
          ) : null}
          {view === "thread" ? (
            <div className="flex h-full min-h-0 min-w-0 w-full flex-1 basis-0 flex-col overflow-hidden">
              <DigestThreadView markdown={visibleMarkdown} listScrollRef={scrollRef} onListScroll={onThreadListScroll} />
            </div>
          ) : null}
          {view === "author" ? (
            <div className="flex h-full min-h-0 min-w-0 w-full flex-1 basis-0 flex-col overflow-hidden">
              <DigestAuthorView
                markdown={visibleMarkdown}
                canLoadOlderDigest={visibleStart > 0}
                onTryLoadOlderDigest={() => tryPrependOlderDigestSlice(null)}
              />
            </div>
          ) : null}
        </DigestAuthorLookupProvider>
      </div>
    </div>
  );
}

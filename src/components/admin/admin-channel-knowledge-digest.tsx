"use client";

import clsx from "clsx";
import { Copy, FileText, MessageSquare, Search, Users, X, type LucideIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type UIEventHandler } from "react";
import {
  ClassicDigestMarkdownView,
  DigestAuthorLookupProvider,
  DigestAuthorView,
  DigestThreadView,
  digestMarkdownForClassic,
  type SlackTranscriptAuthorLookup,
} from "@/components/admin/admin-channel-digest-views";
import { parseDigestBodyLines, splitDigestMarkdown } from "@/lib/channel-digest-parse";
import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";
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
  const flash = useAdminFlashToast();
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

  const filteredMessageCount = useMemo(() => parseDigestBodyLines(bodyLines).length, [bodyLines]);

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

  const [copyMarkdownState, setCopyMarkdownState] = useState<"idle" | "copied" | "error">("idle");
  const copyClassicMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(classicSource);
      setCopyMarkdownState("copied");
      flash("success", "Transcript markdown copied to clipboard.");
      window.setTimeout(() => setCopyMarkdownState("idle"), 2000);
    } catch {
      setCopyMarkdownState("error");
      flash("error", "Could not copy to clipboard.");
      window.setTimeout(() => setCopyMarkdownState("idle"), 2500);
    }
  }, [classicSource, flash]);

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

  const viewTab = (id: DigestView, label: string, ariaLabel: string, Icon: LucideIcon) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={view === id}
      aria-label={ariaLabel}
      title={label}
      onClick={() => setView(id)}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors",
        "size-10 md:size-auto md:px-2.5 md:py-1 md:text-xs",
        view === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-[1.15rem] md:hidden" strokeWidth={2} aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  return (
    <div
      className={clsx(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm",
        // Desktop: avoid a fixed 42rem floor so the workspace fits in the viewport and the site footer stays visible;
        // Employees / Messages / Transcript scroll inside this card via the inner flex + overflow chain.
        view === "classic" ? "min-h-[42rem] md:min-h-0" : "min-h-0",
      )}
    >
      <div className="flex shrink-0 flex-nowrap items-center gap-2 border-b border-border bg-muted/20 px-2 py-2 sm:gap-3 sm:px-4 md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-md md:flex-[0_1_28rem]">
          <div className="relative min-h-10 min-w-0 flex-1 md:min-h-8">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground md:left-2.5 md:size-3.5"
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
              className="h-10 w-full min-w-0 rounded-lg border border-border bg-background py-2 pl-10 pr-10 text-base text-foreground shadow-sm placeholder:text-muted-foreground outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 md:h-8 md:py-1 md:pl-8 md:pr-8 md:text-sm"
              aria-label="Search knowledge base"
              autoComplete="off"
              spellCheck={false}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:size-7"
                aria-label="Clear search"
              >
                <X className="size-4 md:size-3.5" strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
          <span
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium tabular-nums text-muted-foreground md:h-7 md:px-2 md:text-[0.6875rem]"
            title={
              searchQuery.trim()
                ? `${filteredMessageCount.toLocaleString()} message${filteredMessageCount === 1 ? "" : "s"} match this search`
                : `${filteredMessageCount.toLocaleString()} message${filteredMessageCount === 1 ? "" : "s"} in view`
            }
            aria-label={
              searchQuery.trim()
                ? `${filteredMessageCount.toLocaleString()} message${filteredMessageCount === 1 ? "" : "s"} match search`
                : `${filteredMessageCount.toLocaleString()} message${filteredMessageCount === 1 ? "" : "s"}`
            }
            aria-live="polite"
            aria-atomic="true"
          >
            {filteredMessageCount.toLocaleString()}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/40 p-0.5"
            role="tablist"
            aria-label="Knowledge base view"
          >
            {viewTab("author", "Employees", "Employees by author", Users)}
            {viewTab("thread", "Messages", "Messages by thread", MessageSquare)}
            {viewTab("classic", "Transcript", "Transcript", FileText)}
          </div>
          <button
            type="button"
            onClick={copyClassicMarkdown}
            title="Copy transcript as plain text (Slack user ids, matches saved digest format)"
            className={clsx(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors",
              "hover:bg-muted/60 active:scale-[0.98] md:size-9",
            )}
            aria-label={
              copyMarkdownState === "copied"
                ? "Copied to clipboard"
                : copyMarkdownState === "error"
                  ? "Copy failed"
                  : "Copy transcript to clipboard"
            }
          >
            <Copy className="size-4 shrink-0 opacity-80 md:size-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={view === "classic" ? scrollRef : undefined}
        onScroll={view === "classic" ? onClassicScroll : undefined}
        className={clsx(
          "flex min-h-0 min-w-0 flex-1 basis-0 flex-col items-stretch py-2 sm:py-3",
          view === "classic" ? "px-4 sm:px-6" : "px-2 sm:px-4",
          view !== "classic" && "max-md:flex-none max-md:basis-auto max-md:min-h-0",
          view === "classic"
            ? "overflow-y-auto"
            : "overflow-hidden",
        )}
      >
        <DigestAuthorLookupProvider lookup={slackAuthorLookup}>
          {view === "classic" ? (
            <article
              className={clsx(
                "prose prose-sm sm:prose-base max-w-none pb-1",
                "prose-neutral dark:prose-invert",
                "prose-headings:scroll-mt-20 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground",
                "prose-p:text-foreground prose-li:marker:text-muted-foreground prose-li:text-foreground prose-strong:text-foreground",
                "prose-a:text-foreground prose-a:underline prose-a:decoration-muted-foreground/50 prose-a:underline-offset-[3px] hover:prose-a:decoration-foreground/80",
                "prose-code:rounded-md prose-code:border prose-code:border-border/80 prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:bg-muted/30 prose-pre:border prose-pre:border-border",
                "prose-hr:border-border",
                "prose-blockquote:border-l-muted-foreground/40 prose-blockquote:text-muted-foreground",
              )}
            >
              <ClassicDigestMarkdownView markdown={classicSource} />
            </article>
          ) : null}
          {view === "thread" ? (
            <div className="flex h-full min-h-0 min-w-0 w-full max-md:h-auto max-md:flex-none max-md:basis-auto flex-1 basis-0 flex-col overflow-hidden">
              <DigestThreadView markdown={visibleMarkdown} listScrollRef={scrollRef} onListScroll={onThreadListScroll} />
            </div>
          ) : null}
          {view === "author" ? (
            <div className="flex h-full min-h-0 min-w-0 w-full max-md:h-auto max-md:flex-none max-md:basis-auto flex-1 basis-0 flex-col overflow-hidden">
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

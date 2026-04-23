"use client";

import clsx from "clsx";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  DigestAuthorLookupProvider,
  DigestAuthorView,
  DigestThreadView,
  digestMarkdownForClassic,
  type SlackTranscriptAuthorLookup,
} from "@/components/admin/admin-channel-digest-views";
import { splitDigestMarkdown } from "@/lib/channel-digest-parse";

/** First paint: show the tail of the digest so recent channel activity is visible (newest at bottom). */
const INITIAL_VISIBLE_LINES = 120;
/** Each time the user scrolls near the top, reveal this many older lines. */
const LOAD_MORE_LINES = 100;
/** Same spirit as `/twitter` recent-requests table (`admin-health-dashboard`). */
const TOP_SCROLL_THRESHOLD_PX = 80;

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
  /** When set (from `/api/admin/slack-bot-author-profiles`), transcript rows show bot names + headshots for matching Slack user IDs. */
  slackAuthorLookup?: SlackTranscriptAuthorLookup | null;
};

export function AdminChannelKnowledgeDigest({ markdown, slackAuthorLookup }: AdminChannelKnowledgeDigestProps) {
  const { header, bodyLines } = useMemo(() => splitDigestMarkdown(markdown), [markdown]);
  const tailStart = useMemo(() => tailStartIndex(bodyLines), [bodyLines]);

  const [visibleStart, setVisibleStart] = useState(tailStart);
  const [view, setView] = useState<DigestView>("thread");
  const prependingRef = useRef(false);
  const pendingScrollAdjustRef = useRef<PendingScrollAdjust | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialScrollRef = useRef(false);

  useLayoutEffect(() => {
    setVisibleStart(tailStart);
    prependingRef.current = false;
    pendingScrollAdjustRef.current = null;
    didInitialScrollRef.current = false;
  }, [tailStart]);

  useLayoutEffect(() => {
    didInitialScrollRef.current = false;
  }, [view]);

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
    el.scrollTop = el.scrollHeight;
    didInitialScrollRef.current = true;
  }, [visibleMarkdown, view]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || prependingRef.current || visibleStart <= 0) {
      return;
    }
    if (el.scrollTop > TOP_SCROLL_THRESHOLD_PX) {
      return;
    }
    prependingRef.current = true;
    pendingScrollAdjustRef.current = {
      prevHeight: el.scrollHeight,
      prevTop: el.scrollTop,
    };
    setVisibleStart((s) => Math.max(0, s - LOAD_MORE_LINES));
  }, [visibleStart]);

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
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold tracking-tight">Transcript</h2>
        <div
          className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-0.5"
          role="tablist"
          aria-label="Transcript view"
        >
          {viewBtn("thread", "Thread")}
          {viewBtn("author", "By author")}
          {viewBtn("classic", "Markdown")}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={clsx(
          "max-h-[min(48vh,30rem)] min-h-[160px] overflow-auto px-4 py-5",
          view === "classic" &&
            "[&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_li]:my-1 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
        )}
      >
        <DigestAuthorLookupProvider lookup={slackAuthorLookup}>
          {view === "classic" ? (
            <article>
              <ReactMarkdown>{classicSource}</ReactMarkdown>
            </article>
          ) : null}
          {view === "thread" ? <DigestThreadView markdown={visibleMarkdown} /> : null}
          {view === "author" ? <DigestAuthorView markdown={visibleMarkdown} /> : null}
        </DigestAuthorLookupProvider>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/** First paint: show the tail of the digest so recent channel activity is visible (newest at bottom). */
const INITIAL_VISIBLE_LINES = 120;
/** Each time the user scrolls near the top, reveal this many older lines. */
const LOAD_MORE_LINES = 100;
/** Same spirit as `/twitter` recent-requests table (`admin-health-dashboard`). */
const TOP_SCROLL_THRESHOLD_PX = 80;

function splitDigestMarkdown(markdown: string): { header: string; bodyLines: string[] } {
  const lines = markdown.split("\n");
  let startBody = 0;
  if (lines.length > 0 && lines[0].trim().startsWith("#")) {
    startBody = 1;
    while (startBody < lines.length && lines[startBody].trim() === "") {
      startBody++;
    }
  }
  const header = lines.slice(0, startBody).join("\n");
  const bodyLines = lines.slice(startBody);
  return { header, bodyLines };
}

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
};

export function AdminChannelKnowledgeDigest({ markdown }: AdminChannelKnowledgeDigestProps) {
  const { header, bodyLines } = useMemo(() => splitDigestMarkdown(markdown), [markdown]);
  const tailStart = useMemo(() => tailStartIndex(bodyLines), [bodyLines]);

  const [visibleStart, setVisibleStart] = useState(tailStart);
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

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScrollAdjustRef.current;
    if (el && pending) {
      el.scrollTop = pending.prevTop + (el.scrollHeight - pending.prevHeight);
      pendingScrollAdjustRef.current = null;
    }
    prependingRef.current = false;
  }, [visibleMarkdown]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScrollRef.current || !visibleMarkdown.trim()) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    didInitialScrollRef.current = true;
  }, [visibleMarkdown]);

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

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/20 px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">Transcript</h2>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-[min(36vh,26rem)] min-h-[160px] overflow-auto px-4 py-5 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_li]:my-1 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
      >
        <article>
          <ReactMarkdown>{visibleMarkdown}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

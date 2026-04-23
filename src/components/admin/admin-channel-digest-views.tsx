"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  authorColumnOrder,
  buildThreadUnits,
  groupLinesByAuthor,
  parseDigestBodyLines,
  splitDigestMarkdown,
  stripDigestThreadMarkers,
  type DigestLine,
  type ThreadUnit,
} from "@/lib/channel-digest-parse";

export type SlackTranscriptAuthor = {
  displayName: string;
  portraitUrl: string;
};

/** Slack user id (any casing) → display + portrait; from `/api/admin/slack-bot-author-profiles` or `/api/portal/slack-bot-author-profiles`. */
export type SlackTranscriptAuthorLookup = Record<string, SlackTranscriptAuthor>;

const DigestAuthorLookupContext = createContext<SlackTranscriptAuthorLookup | null>(null);

export function DigestAuthorLookupProvider({
  lookup,
  children,
}: {
  lookup: SlackTranscriptAuthorLookup | null | undefined;
  children: ReactNode;
}) {
  const value = lookup && Object.keys(lookup).length > 0 ? lookup : null;
  return <DigestAuthorLookupContext.Provider value={value}>{children}</DigestAuthorLookupContext.Provider>;
}

function useDigestAuthorLookup(): SlackTranscriptAuthorLookup | null {
  return useContext(DigestAuthorLookupContext);
}

function resolveTranscriptAuthor(
  userId: string,
  lookup: SlackTranscriptAuthorLookup | null,
): SlackTranscriptAuthor | null {
  if (!lookup) {
    return null;
  }
  const key = userId.trim().toUpperCase();
  return lookup[key] ?? null;
}

function avatarHue(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) % 360;
  }
  return h;
}

function Avatar({ userId, author }: { userId: string; author: SlackTranscriptAuthor | null }) {
  if (author?.portraitUrl) {
    return (
      <div className="relative size-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted shadow-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={author.portraitUrl} alt="" className="size-full object-cover" />
      </div>
    );
  }
  const hue = avatarHue(userId);
  const label =
    userId.length <= 2 ? userId.toUpperCase() : userId.replace(/^U/, "").slice(-2).toUpperCase();
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tracking-tight text-white shadow-inner"
      style={{ backgroundColor: `hsl(${hue} 42% 36%)` }}
      aria-hidden
    >
      {label}
    </div>
  );
}

function AuthorHeading({ author }: { author: SlackTranscriptAuthor | null }) {
  const label = author?.displayName?.trim() || "Unknown participant";
  return (
    <p className="truncate text-sm font-semibold tracking-tight text-foreground" title={label}>
      {label}
    </p>
  );
}

function DigestBodyMarkdown({ text }: { text: string }) {
  const lookup = useDigestAuthorLookup();
  const processed = useMemo(() => {
    if (!lookup) {
      return text;
    }
    return text.replace(/<@(U[A-Z0-9]+)>/gi, (_m, rawId: string) => {
      const row = lookup[rawId.toUpperCase()];
      return row ? `@${row.displayName}` : `<@${rawId}>`;
    });
  }, [text, lookup]);
  return (
    <div className="digest-card-md text-[13px] leading-relaxed text-foreground [&_em]:italic [&_p]:my-1 [&_strong]:font-semibold">
      <ReactMarkdown>{processed}</ReactMarkdown>
    </div>
  );
}

function pickThreadRoot(unit: ThreadUnit): DigestLine {
  const { messages, threadKey } = unit;
  const byTs = messages.find((m: DigestLine) => m.msgTs === threadKey);
  if (byTs) {
    return byTs;
  }
  const nonReply = messages.find((m: DigestLine) => !m.isReply);
  return nonReply ?? messages[0]!;
}

function ThreadReplyCard({ line, author }: { line: DigestLine; author: SlackTranscriptAuthor | null }) {
  return (
    <div className="w-full rounded-r-lg rounded-bl-lg border border-border/70 border-l-transparent bg-muted/15 py-2.5 pl-2 pr-3 shadow-sm">
      <div className="flex gap-2.5">
        <Avatar userId={line.userId} author={author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <AuthorHeading author={author} />
            {line.isReply ? (
              <span className="rounded bg-muted/80 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                reply
              </span>
            ) : null}
          </div>
          <DigestBodyMarkdown text={line.body} />
        </div>
      </div>
    </div>
  );
}

function ThreadRightPanelEmpty() {
  return (
    <div
      className="flex min-h-[10rem] flex-1 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
      role="status"
    >
      No replies in this thread
    </div>
  );
}

function ThreadRightPanelSelectPrompt() {
  return (
    <div
      className="flex min-h-[12rem] flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground"
      role="status"
    >
      Select a channel message to view its thread.
    </div>
  );
}

function threadUnitListKey(u: ThreadUnit): string {
  return `${u.threadKey}:${u.messages.map((m: DigestLine) => m.order).join("-")}`;
}

function ThreadRootListRow({
  unit,
  selected,
  onSelect,
}: {
  unit: ThreadUnit;
  selected: boolean;
  onSelect: () => void;
}) {
  const lookup = useDigestAuthorLookup();
  const root = pickThreadRoot(unit);
  const threadCount = unit.messages.length;
  const rootAuthor = resolveTranscriptAuthor(root.userId, lookup);
  const hasThreadStack = threadCount > 1;

  return (
    <div role="listitem" className="relative w-full">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={clsx(
          "relative w-full cursor-pointer rounded-xl border p-2.5 pr-2.5 text-left transition-[colors,box-shadow,opacity,ring] [&_*]:cursor-inherit",
          selected
            ? "border-transparent bg-white opacity-50 shadow-none ring-0 hover:border-transparent hover:bg-white hover:shadow-none dark:bg-background dark:hover:bg-background"
            : clsx(
                hasThreadStack ? "shadow-lg" : "shadow-sm",
                hasThreadStack
                  ? "border-border/80 bg-card hover:border-border hover:bg-card/50 border-l-[3px] border-l-muted-foreground/40 hover:border-l-muted-foreground/55"
                  : "border-border/80 bg-card hover:border-border hover:bg-muted/30",
              ),
        )}
      >
        <div className="flex gap-2.5">
          <Avatar userId={root.userId} author={rootAuthor} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <AuthorHeading author={rootAuthor} />
              {hasThreadStack ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{threadCount} msgs</span>
              ) : null}
              {!unit.hasMeta && unit.messages.some((m: DigestLine) => m.isReply) ? (
                <span
                  className="text-[10px] text-amber-700/90 dark:text-amber-400/90"
                  title="Digest was built without thread markers; replies may be grouped by position only until the next hourly refresh."
                >
                  approx. grouping
                </span>
              ) : null}
            </div>
            <div className="mt-1 line-clamp-2 text-left text-[12px] leading-snug text-muted-foreground">
              <span className="text-foreground/90">{root.body.replace(/\s+/g, " ").trim()}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

/** Root message pinned to the top of the right-hand thread column (replies scroll beneath). */
function ThreadRightStickyRoot({
  unit,
  onClose,
}: {
  unit: ThreadUnit;
  onClose: () => void;
}) {
  const lookup = useDigestAuthorLookup();
  const root = pickThreadRoot(unit);
  const threadCount = unit.messages.length;
  const rootAuthor = resolveTranscriptAuthor(root.userId, lookup);
  const hasThreadStack = threadCount > 1;

  return (
    <div
      role="region"
      aria-label="Selected thread"
      className="sticky top-0 z-[4] border-b border-border/70 bg-background/95 px-1 pb-2.5 pt-1 shadow-[0_1px_0_rgba(0,0,0,0.04)] backdrop-blur-sm dark:bg-background/95 dark:shadow-[0_1px_0_rgba(255,255,255,0.06)]"
    >
      <div className="relative">
        <div className="rounded-xl border border-border/80 bg-white p-2.5 pr-11 shadow-none dark:bg-background">
          <div className="flex gap-2.5">
            <Avatar userId={root.userId} author={rootAuthor} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <AuthorHeading author={rootAuthor} />
                {hasThreadStack ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{threadCount} msgs</span>
                ) : null}
                {!unit.hasMeta && unit.messages.some((m: DigestLine) => m.isReply) ? (
                  <span
                    className="text-[10px] text-amber-700/90 dark:text-amber-400/90"
                    title="Digest was built without thread markers; replies may be grouped by position only until the next hourly refresh."
                  >
                    approx. grouping
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5">
                <DigestBodyMarkdown text={root.body} />
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close thread"
          title="Close thread"
          onClick={onClose}
          className="absolute right-1 top-1 z-[1] flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted/50 active:scale-95 dark:hover:bg-muted/40"
        >
          <X className="size-4 stroke-[2.5]" strokeLinecap="round" />
        </button>
      </div>
    </div>
  );
}

export type DigestThreadViewProps = {
  markdown: string;
  /** Scroll container for the channel-message list (left); used for “load older” in the parent. */
  listScrollRef?: RefObject<HTMLDivElement | null>;
  onListScroll?: UIEventHandler<HTMLDivElement>;
};

export function DigestThreadView({ markdown, listScrollRef, onListScroll }: DigestThreadViewProps) {
  const units = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    return buildThreadUnits(lines);
  }, [markdown]);

  /** Left column: one row per channel (non-reply) root; excludes orphan reply-only buckets. */
  const channelRootUnits = useMemo(
    () => units.filter((u) => !pickThreadRoot(u).isReply),
    [units],
  );

  /** Newest thread first in the left list (parser order is oldest → newest). */
  const channelRootUnitsNewestFirst = useMemo(
    () => [...channelRootUnits].reverse(),
    [channelRootUnits],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rightThreadScrollRef = useRef<HTMLDivElement | null>(null);

  /** Keep selection only if that thread is still in the visible slice; never auto-select on load. */
  useLayoutEffect(() => {
    if (channelRootUnitsNewestFirst.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => {
      if (prev && channelRootUnitsNewestFirst.some((u) => u.threadKey === prev)) {
        return prev;
      }
      return null;
    });
  }, [channelRootUnitsNewestFirst]);

  const dismissThreadPanel = useCallback(() => {
    setSelectedKey(null);
  }, []);

  const selectThreadRoot = useCallback((threadKey: string) => {
    setSelectedKey(threadKey);
  }, []);

  /** Snap the right column so the sticky root sits at the top of the viewport. */
  useLayoutEffect(() => {
    const el = rightThreadScrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = 0;
  }, [selectedKey]);

  const selectedUnit = useMemo(
    () => units.find((u) => u.threadKey === selectedKey) ?? null,
    [units, selectedKey],
  );

  const replies = useMemo(() => {
    if (!selectedUnit) {
      return [] as DigestLine[];
    }
    const root = pickThreadRoot(selectedUnit);
    return selectedUnit.messages.filter((m: DigestLine) => m !== root);
  }, [selectedUnit]);

  const lookup = useDigestAuthorLookup();

  if (units.length === 0) {
    return <p className="text-sm text-muted-foreground">No parsed messages in this digest.</p>;
  }

  if (channelRootUnitsNewestFirst.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No channel-level messages to show in thread view.</p>
    );
  }

  return (
    <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-0 divide-y divide-border/80 md:grid-cols-2 md:grid-rows-1 md:divide-y-0">
      <div className="flex min-h-0 min-w-0 flex-col">
        <div
          ref={listScrollRef}
          onScroll={onListScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain border-b border-border/60 bg-muted/10 px-2 py-2 md:border-b-0 md:bg-transparent md:px-3 md:py-3 [scrollbar-gutter:stable]"
        >
          <div className="flex flex-col gap-2" role="list" aria-label="Channel messages">
            {channelRootUnitsNewestFirst.map((u) => (
              <ThreadRootListRow
                key={threadUnitListKey(u)}
                unit={u}
                selected={u.threadKey === selectedKey}
                onSelect={() => {
                  if (u.threadKey === selectedKey) {
                    dismissThreadPanel();
                  } else {
                    selectThreadRoot(u.threadKey);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div
          ref={rightThreadScrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 py-2 md:px-3 md:py-3 [scrollbar-gutter:stable]"
        >
          {!selectedUnit ? (
            <ThreadRightPanelSelectPrompt />
          ) : (
            <>
              <ThreadRightStickyRoot unit={selectedUnit} onClose={dismissThreadPanel} />
              {replies.length > 0 ? (
                <div
                  className="relative mt-2 flex-1 border-l-2 border-muted-foreground/25 pl-3 md:ml-1 md:pl-4"
                  aria-label="Thread replies"
                >
                  <div className="flex flex-col gap-2.5 pb-1">
                    {replies.map((r) => (
                      <ThreadReplyCard
                        key={r.order}
                        line={r}
                        author={resolveTranscriptAuthor(r.userId, lookup)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-2 min-h-[6rem] flex-1">
                  <ThreadRightPanelEmpty />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DigestAuthorView({ markdown }: { markdown: string }) {
  const lookup = useDigestAuthorLookup();
  const { columns, order } = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    const orderIds = authorColumnOrder(lines);
    const by = groupLinesByAuthor(lines);
    return { columns: by, order: orderIds };
  }, [markdown]);

  if (order.length === 0) {
    return <p className="text-sm text-muted-foreground">No parsed messages in this digest.</p>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-gutter:stable]">
      {order.map((uid) => {
        const msgs = columns.get(uid) ?? [];
        const author = resolveTranscriptAuthor(uid, lookup);
        return (
          <div
            key={uid}
            className="flex w-[min(100%,280px)] shrink-0 flex-col gap-2 rounded-xl border border-border/80 bg-muted/10 p-2"
          >
            <div className="sticky top-0 z-[1] flex items-center gap-2 rounded-lg border border-border/60 bg-card/95 px-2 py-2 backdrop-blur-sm">
              <Avatar userId={uid} author={author} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {author?.displayName?.trim() || "Unknown participant"}
                </p>
                <p className="text-[10px] text-muted-foreground">{msgs.length} messages</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {msgs.map((line) => (
                <div
                  key={line.order}
                  className={clsx(
                    "rounded-lg border border-border/70 bg-card p-2 shadow-sm",
                    line.isReply
                      ? "ml-3 border-l-[3px] border-l-muted-foreground/35 pl-3 md:ml-4 md:pl-3.5"
                      : "",
                  )}
                >
                  {line.isReply ? (
                    <span className="mb-1 inline-block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      thread
                    </span>
                  ) : null}
                  <DigestBodyMarkdown text={line.body} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function digestMarkdownForClassic(markdown: string): string {
  const { header, bodyLines } = splitDigestMarkdown(markdown);
  const strippedLines = bodyLines.map((ln) => stripDigestThreadMarkers(ln));
  const body = strippedLines.join("\n");
  if (!header) {
    return body;
  }
  if (!body.trim()) {
    return header;
  }
  return `${header}\n\n${body}`;
}

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
  type UIEvent,
  type UIEventHandler,
} from "react";

/** Match `TOP_SCROLL_THRESHOLD_PX` in admin-channel-knowledge-digest for “load older” while scrolled near top. */
const AUTHOR_COLUMN_TOP_SCROLL_THRESHOLD_PX = 80;
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

/** Same visual language as transcript author cards (digest thread reply row). */
export function DigestStyleUserMessageCard({
  slackUserId,
  author,
  bodyMarkdown,
}: {
  slackUserId: string;
  author: SlackTranscriptAuthor | null;
  bodyMarkdown: string;
}) {
  return (
    <div
      className="w-full rounded-xl border border-border/80 bg-white py-2.5 pl-2 pr-3 shadow-sm dark:bg-card"
      role="article"
    >
      <div className="flex gap-2.5">
        <Avatar userId={slackUserId} author={author} />
        <div className="min-w-0 flex-1">
          <AuthorHeading author={author} />
          <DigestBodyMarkdown text={bodyMarkdown} />
        </div>
      </div>
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

function threadUnitHasReplies(unit: ThreadUnit): boolean {
  const root = pickThreadRoot(unit);
  return unit.messages.some((m: DigestLine) => m !== root);
}

function ThreadReplyCard({
  line,
  author,
  staggerIndex,
  onClose,
  closeAriaLabel,
}: {
  line: DigestLine;
  author: SlackTranscriptAuthor | null;
  staggerIndex: number;
  /** When set, a close control is shown at the top-right of this card (first message in the right column). */
  onClose?: () => void;
  closeAriaLabel?: string;
}) {
  return (
    <div
      className="digest-thread-reply-in relative w-full rounded-xl border border-border/80 bg-muted/15 py-2.5 pl-2 pr-3 shadow-sm transition-[border-color,box-shadow] duration-500 ease-in-out"
      style={{ animationDelay: `${staggerIndex * 70}ms` }}
    >
      {onClose ? (
        <button
          type="button"
          aria-label={closeAriaLabel ?? "Close"}
          title="Close"
          onClick={onClose}
          className="absolute right-2 top-2 z-[1] flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-500 ease-in-out hover:bg-muted/50 active:scale-95 dark:hover:bg-muted/40"
        >
          <X className="size-4 stroke-[2.5]" strokeLinecap="round" />
        </button>
      ) : null}
      <div className={clsx("flex gap-2.5", onClose && "pr-10")}>
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

function AuthorRightPanelSelectPrompt() {
  return (
    <div
      className="flex min-h-[12rem] flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground"
      role="status"
    >
      Select an employee to view their messages.
    </div>
  );
}

function AuthorRightPanelEmpty() {
  return (
    <div
      className="flex min-h-[10rem] flex-1 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
      role="status"
    >
      No messages for this author
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
  const hasReplies = threadUnitHasReplies(unit);

  return (
    <div role="listitem" className="relative w-full">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={clsx(
          "relative w-full rounded-xl p-2.5 pr-2.5 text-left transition-[background-color,border-color,box-shadow]",
          hasReplies
            ? "cursor-pointer [&_*]:cursor-inherit"
            : "cursor-not-allowed [&_*]:cursor-not-allowed",
          selected
            ? "border-0 bg-white shadow-none hover:bg-white dark:bg-white dark:text-foreground dark:hover:bg-white"
            : clsx(
                "border border-border/70 shadow-sm",
                hasReplies
                  ? "bg-muted/50 hover:bg-muted/60 border-l-[3px] border-l-muted-foreground/35 hover:border-l-muted-foreground/50 dark:bg-muted/35 dark:hover:bg-muted/45"
                  : "bg-muted/50 hover:bg-muted/60 dark:bg-muted/35 dark:hover:bg-muted/45",
              ),
        )}
      >
        <div className="flex gap-2.5">
          <Avatar userId={root.userId} author={rootAuthor} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <AuthorHeading author={rootAuthor} />
              {hasReplies ? (
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

function AuthorEmployeeListRow({
  userId,
  author,
  messageCount,
  previewBody,
  selected,
  onSelect,
}: {
  userId: string;
  author: SlackTranscriptAuthor | null;
  messageCount: number;
  previewBody: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const hasMany = messageCount > 1;
  return (
    <div role="listitem" className="relative w-full">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={clsx(
          "relative w-full cursor-pointer rounded-xl p-2.5 pr-2.5 text-left transition-[background-color,border-color,box-shadow] [&_*]:cursor-inherit",
          selected
            ? "border-0 bg-white shadow-none hover:bg-white dark:bg-white dark:text-foreground dark:hover:bg-white"
            : clsx(
                "border border-border/70 shadow-sm",
                hasMany
                  ? "bg-muted/50 hover:bg-muted/60 border-l-[3px] border-l-muted-foreground/35 hover:border-l-muted-foreground/50 dark:bg-muted/35 dark:hover:bg-muted/45"
                  : "bg-muted/50 hover:bg-muted/60 dark:bg-muted/35 dark:hover:bg-muted/45",
              ),
        )}
      >
        <div className="flex gap-2.5">
          <Avatar userId={userId} author={author} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <AuthorHeading author={author} />
              {hasMany ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{messageCount} msgs</span>
              ) : null}
            </div>
            <div className="mt-1 line-clamp-2 text-left text-[12px] leading-snug text-muted-foreground">
              <span className="text-foreground/90">{previewBody.replace(/\s+/g, " ").trim()}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

export type DigestThreadViewProps = {
  markdown: string;
  /** Scroll container for the channel-message list (left); used for “load older” in the parent. */
  listScrollRef?: RefObject<HTMLDivElement | null>;
  onListScroll?: UIEventHandler<HTMLDivElement>;
};

/** Shared two-pane chrome for Threads + Authors so height and flex behavior match exactly. */
function DigestTwoPaneShell({
  leftScrollRef,
  onLeftScroll,
  leftList,
  rightPanel,
}: {
  leftScrollRef?: RefObject<HTMLDivElement | null>;
  onLeftScroll?: UIEventHandler<HTMLDivElement>;
  leftList: ReactNode;
  rightPanel: ReactNode;
}) {
  return (
    <div className="grid h-full max-h-full min-h-0 w-full flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-0 divide-y divide-border/80 md:grid-cols-2 md:grid-rows-1 md:divide-y-0">
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div
          ref={leftScrollRef}
          onScroll={onLeftScroll}
          className="digest-view-scroll h-full min-h-0 flex-1 overflow-y-auto overscroll-y-contain border-b border-border/60 bg-muted/10 px-2 py-2 md:border-b-0 md:bg-transparent md:px-3 md:py-3 [scrollbar-gutter:stable]"
        >
          {leftList}
        </div>
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-2 py-2 md:px-3 md:py-3">
          {rightPanel}
        </div>
      </div>
    </div>
  );
}

export function DigestThreadView({ markdown, listScrollRef, onListScroll }: DigestThreadViewProps) {
  const units = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    return buildThreadUnits(lines);
  }, [markdown]);

  /** Left column: one row per threaded conversation (non-reply root with at least one reply). */
  const channelRootUnits = useMemo(
    () => units.filter((u) => !pickThreadRoot(u).isReply && threadUnitHasReplies(u)),
    [units],
  );

  /** Newest thread first in the left list (parser order is oldest → newest). */
  const channelRootUnitsNewestFirst = useMemo(
    () => [...channelRootUnits].reverse(),
    [channelRootUnits],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rightThreadScrollRef = useRef<HTMLDivElement | null>(null);

  /** Keep selection if still in the visible slice; otherwise default to newest thread (same idea as Authors). */
  useLayoutEffect(() => {
    if (channelRootUnitsNewestFirst.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => {
      if (prev && channelRootUnitsNewestFirst.some((u) => u.threadKey === prev)) {
        return prev;
      }
      return channelRootUnitsNewestFirst[0]!.threadKey;
    });
  }, [channelRootUnitsNewestFirst]);

  const dismissThreadPanel = useCallback(() => {
    setSelectedKey(null);
  }, []);

  const selectThreadRoot = useCallback((threadKey: string) => {
    setSelectedKey(threadKey);
  }, []);

  /** Snap the right column to the top when switching threads. */
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
      <p className="text-sm text-muted-foreground">No threads with replies in this digest.</p>
    );
  }

  return (
    <>
      <DigestTwoPaneShell
        leftScrollRef={listScrollRef}
        onLeftScroll={onListScroll}
        leftList={
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
        }
        rightPanel={
        !selectedUnit ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ThreadRightPanelSelectPrompt />
          </div>
        ) : (
          <div key={selectedUnit.threadKey} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={rightThreadScrollRef}
              className="digest-view-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1 [scrollbar-gutter:stable]"
            >
              {replies.length > 0 ? (
                <div className="flex flex-col gap-2.5 pb-1" aria-label="Thread replies">
                  {replies.map((r, i) => (
                    <ThreadReplyCard
                      key={r.order}
                      line={r}
                      author={resolveTranscriptAuthor(r.userId, lookup)}
                      staggerIndex={i}
                      onClose={i === 0 ? dismissThreadPanel : undefined}
                      closeAriaLabel={i === 0 ? "Close thread" : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="min-h-[6rem] flex-1">
                  <div className="digest-thread-reply-in" style={{ animationDelay: "0ms" }}>
                    <ThreadRightPanelEmpty />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }
      />
    </>
  );
}

export type DigestAuthorViewProps = {
  markdown: string;
  /** When false, scrolling a column to the top does not request older digest lines. */
  canLoadOlderDigest?: boolean;
  /** Return true if older lines were scheduled (used to preserve per-column scroll after prepend). */
  onTryLoadOlderDigest?: () => boolean;
};

export function DigestAuthorView({
  markdown,
  canLoadOlderDigest = false,
  onTryLoadOlderDigest,
}: DigestAuthorViewProps) {
  const lookup = useDigestAuthorLookup();
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingMessageScrollAdjustRef = useRef<{ prevH: number; prevT: number } | null>(null);

  const { columns, order, defaultAuthorUserId } = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    const orderIds = authorColumnOrder(lines);
    const by = groupLinesByAuthor(lines);
    const lastLine = lines.length > 0 ? lines[lines.length - 1]! : null;
    const defaultAuthorUserId = lastLine?.userId ?? null;
    return { columns: by, order: orderIds, defaultAuthorUserId };
  }, [markdown]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (order.length === 0) {
      setSelectedUserId(null);
      return;
    }
    setSelectedUserId((prev) => {
      if (prev && order.some((id) => id === prev)) {
        return prev;
      }
      if (defaultAuthorUserId && order.some((id) => id === defaultAuthorUserId)) {
        return defaultAuthorUserId;
      }
      return order[0] ?? null;
    });
  }, [order, defaultAuthorUserId]);

  const dismissAuthorPanel = useCallback(() => {
    setSelectedUserId(null);
  }, []);

  const selectAuthor = useCallback((userId: string) => {
    setSelectedUserId(userId);
  }, []);

  const prevSelectedUserIdRef = useRef<string | null>(null);

  const onMessagesScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!canLoadOlderDigest || !onTryLoadOlderDigest) {
        return;
      }
      if (e.currentTarget.scrollTop > AUTHOR_COLUMN_TOP_SCROLL_THRESHOLD_PX) {
        return;
      }
      const el = e.currentTarget;
      pendingMessageScrollAdjustRef.current = { prevH: el.scrollHeight, prevT: el.scrollTop };
      if (!onTryLoadOlderDigest()) {
        pendingMessageScrollAdjustRef.current = null;
        return;
      }
    },
    [canLoadOlderDigest, onTryLoadOlderDigest],
  );

  useLayoutEffect(() => {
    const el = messageScrollRef.current;
    if (!el) {
      prevSelectedUserIdRef.current = selectedUserId;
      return;
    }
    const pending = pendingMessageScrollAdjustRef.current;
    if (pending) {
      el.scrollTop = pending.prevT + (el.scrollHeight - pending.prevH);
      pendingMessageScrollAdjustRef.current = null;
      prevSelectedUserIdRef.current = selectedUserId;
      return;
    }
    if (!selectedUserId) {
      prevSelectedUserIdRef.current = null;
      return;
    }
    const selChanged = prevSelectedUserIdRef.current !== selectedUserId;
    prevSelectedUserIdRef.current = selectedUserId;
    if (selChanged) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [markdown, selectedUserId]);

  const selectedMsgs = selectedUserId ? (columns.get(selectedUserId) ?? []) : [];

  if (order.length === 0) {
    return <p className="text-sm text-muted-foreground">No parsed messages in this digest.</p>;
  }

  return (
    <DigestTwoPaneShell
      leftList={
        <div className="flex flex-col gap-2" role="list" aria-label="Employees">
          {order.map((uid) => {
            const msgs = columns.get(uid) ?? [];
            const author = resolveTranscriptAuthor(uid, lookup);
            const previewBody =
              msgs.length > 0 ? msgs[msgs.length - 1]!.body : "";
            return (
              <AuthorEmployeeListRow
                key={uid}
                userId={uid}
                author={author}
                messageCount={msgs.length}
                previewBody={previewBody}
                selected={uid === selectedUserId}
                onSelect={() => {
                  if (uid === selectedUserId) {
                    dismissAuthorPanel();
                  } else {
                    selectAuthor(uid);
                  }
                }}
              />
            );
          })}
        </div>
      }
      rightPanel={
        !selectedUserId ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AuthorRightPanelSelectPrompt />
          </div>
        ) : (
          <div key={selectedUserId} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={messageScrollRef}
              onScroll={onMessagesScroll}
              className="digest-view-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1 [scrollbar-gutter:stable]"
            >
              {selectedMsgs.length > 0 ? (
                <div className="flex flex-col gap-2.5 pb-1" aria-label="Author messages">
                  {selectedMsgs.map((line, i) => (
                    <ThreadReplyCard
                      key={line.order}
                      line={line}
                      author={resolveTranscriptAuthor(line.userId, lookup)}
                      staggerIndex={i}
                      onClose={i === 0 ? dismissAuthorPanel : undefined}
                      closeAriaLabel={i === 0 ? "Close author" : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="min-h-[6rem] flex-1">
                  <div className="digest-thread-reply-in" style={{ animationDelay: "0ms" }}>
                    <AuthorRightPanelEmpty />
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }
    />
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

"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEvent,
  type UIEventHandler,
} from "react";
import { createPortal } from "react-dom";

import { readIsMdLayoutViewport, useIsMdLayout } from "@/hooks/use-is-md-layout";

/** Author right column (newest at top): load older digest slice when scrolled near the bottom. */
const AUTHOR_MESSAGES_BOTTOM_SCROLL_THRESHOLD_PX = 80;
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  authorColumnOrder,
  buildThreadUnits,
  DIGEST_MARKDOWN_BULLET_LINE_RE,
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

type AvatarVariant = "card" | "row";

function Avatar({
  userId,
  author,
  variant = "card",
}: {
  userId: string;
  author: SlackTranscriptAuthor | null;
  /** `row`: smaller circle for classic digest (Markdown tab). */
  variant?: AvatarVariant;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    setImgBroken(false);
  }, [author?.portraitUrl, userId]);

  const isRow = variant === "row";
  const hue = avatarHue(userId);
  const label =
    userId.length <= 2 ? userId.toUpperCase() : userId.replace(/^U/, "").slice(-2).toUpperCase();

  const portrait = String(author?.portraitUrl ?? "").trim();
  if (portrait && !imgBroken) {
    return (
      <div
        className={clsx(
          "relative shrink-0 overflow-hidden border border-border/80 bg-muted shadow-sm",
          isRow ? "size-7 rounded-full" : "size-9 rounded-md shadow-inner",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={portrait}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setImgBroken(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center font-bold tracking-tight text-white shadow-inner",
        isRow ? "size-7 rounded-full text-[10px]" : "size-9 rounded-md text-[11px]",
      )}
      style={{ backgroundColor: `hsl(${hue} 42% 36%)` }}
      aria-hidden
    >
      {label}
    </div>
  );
}

function AuthorHeading({
  author,
  className,
  as: Comp = "p",
}: {
  author: SlackTranscriptAuthor | null;
  className?: string;
  /** `span` keeps the label on one line with following transcript text (classic digest). */
  as?: "p" | "span";
}) {
  const label = author?.displayName?.trim() || "Unknown participant";
  return (
    <Comp
      className={clsx("truncate text-sm font-semibold tracking-tight text-foreground", className)}
      title={label}
    >
      {label}
    </Comp>
  );
}

function DigestBodyMarkdown({
  text,
  variant = "default",
}: {
  text: string;
  /** First paragraph flows after the author name on one row; later blocks stack (classic digest). */
  /** `transcript`: body under the author heading; paragraphs align with the name (Transcript tab). */
  variant?: "default" | "classicInline" | "transcript";
}) {
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
    <div
      className={clsx(
        "digest-card-md text-[13px] text-foreground [&_em]:italic [&_strong]:font-semibold",
        variant === "classicInline"
          ? "min-w-0 flex-1 basis-0 leading-snug [&_p]:m-0 [&_p:first-of-type]:inline [&_p:not(:first-of-type)]:mt-0.5 [&_p:not(:first-of-type)]:block [&_ul]:my-0 [&_ol]:my-0 [&_li]:my-0"
          : variant === "transcript"
            ? "min-w-0 text-left leading-snug [&_p]:my-0 [&_p:not(:first-of-type)]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5"
            : "leading-relaxed [&_p]:my-1",
      )}
    >
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
  /** When set, a close control is shown at the top-right of this card (e.g. newest row in the author column). */
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
      No messages for this employee
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
          "relative w-full rounded-xl p-2 pr-2 text-left transition-[background-color,border-color,box-shadow] md:p-2.5 md:pr-2.5",
          "cursor-pointer [&_*]:cursor-inherit",
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
  selected,
  onSelect,
}: {
  userId: string;
  author: SlackTranscriptAuthor | null;
  messageCount: number;
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
          "relative w-full cursor-pointer rounded-xl p-2 pr-2 text-left transition-[background-color,border-color,box-shadow] md:p-2.5 md:pr-2.5 [&_*]:cursor-inherit",
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
        <div className="flex items-center gap-2.5">
          <Avatar userId={userId} author={author} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <AuthorHeading author={author} />
              <span className="shrink-0 rounded-full border border-border/60 bg-muted/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground dark:bg-muted/50">
                {messageCount} {messageCount === 1 ? "msg" : "msgs"}
              </span>
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

/** Shared two-pane chrome for Threads + Authors; on narrow viewports the right pane opens as a full-screen sheet. */
function DigestTwoPaneShell({
  isMdLayout,
  detailOpen,
  onCloseDetail,
  detailTitle,
  leftScrollRef,
  onLeftScroll,
  leftList,
  rightPanel,
}: {
  isMdLayout: boolean;
  detailOpen: boolean;
  onCloseDetail: () => void;
  detailTitle: ReactNode;
  leftScrollRef?: RefObject<HTMLDivElement | null>;
  onLeftScroll?: UIEventHandler<HTMLDivElement>;
  leftList: ReactNode;
  rightPanel: ReactNode;
}) {
  const rightChrome = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-1.5 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-3 md:py-3">
      {rightPanel}
    </div>
  );

  useEffect(() => {
    if (!detailOpen || isMdLayout) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseDetail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [detailOpen, isMdLayout, onCloseDetail]);

  const mobileOverlay =
    !isMdLayout && detailOpen ? (
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-background"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-detail-sheet-title"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card/95 px-3 py-3 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-card/80 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]">
          <div id="digest-detail-sheet-title" className="min-w-0 flex-1">
            {detailTitle}
          </div>
          <button
            type="button"
            onClick={onCloseDetail}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-foreground shadow-sm transition-colors hover:bg-muted/70 active:scale-[0.98]"
            aria-label="Close"
          >
            <X className="size-5 stroke-[2.25]" strokeLinecap="round" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{rightChrome}</div>
      </div>
    ) : null;

  return (
    <>
      <div
        className={clsx(
          "min-h-0 w-full gap-0",
          isMdLayout
            ? "grid h-full max-h-full flex-1 grid-cols-2 grid-rows-1"
            : "flex min-h-0 w-full min-w-0 flex-1 flex-col",
        )}
      >
        <div
          className={clsx("flex min-w-0 flex-col", isMdLayout ? "h-full min-h-0" : "min-h-0 flex-1")}
        >
          <div
            ref={leftScrollRef}
            onScroll={onLeftScroll}
            className={clsx(
              "digest-view-scroll overscroll-y-contain bg-muted/10 px-1.5 py-1.5 [scrollbar-gutter:stable] md:bg-transparent md:px-3 md:py-3",
              isMdLayout
                ? "h-full min-h-0 flex-1 overflow-y-auto"
                : "min-h-0 flex-1 overflow-y-auto max-h-[min(70dvh,28rem)]",
            )}
          >
            {leftList}
          </div>
        </div>
        {isMdLayout ? <div className="flex h-full min-h-0 min-w-0 flex-col">{rightChrome}</div> : null}
      </div>
      {mobileOverlay && typeof document !== "undefined" ? createPortal(mobileOverlay, document.body) : null}
    </>
  );
}

export function DigestThreadView({ markdown, listScrollRef, onListScroll }: DigestThreadViewProps) {
  const isMdLayout = useIsMdLayout();
  const units = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    return buildThreadUnits(lines);
  }, [markdown]);

  /** Left column: one row per channel root (top-level message), including standalones with no replies. */
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

  /** Keep selection if still in the visible slice; on `md+` default to newest thread; on narrow viewports start with no selection (sheet on tap). */
  useLayoutEffect(() => {
    if (channelRootUnitsNewestFirst.length === 0) {
      setSelectedKey(null);
      return;
    }
    const md = readIsMdLayoutViewport();
    setSelectedKey((prev) => {
      if (!md) {
        if (prev && channelRootUnitsNewestFirst.some((u) => u.threadKey === prev)) {
          return prev;
        }
        return null;
      }
      if (prev && channelRootUnitsNewestFirst.some((u) => u.threadKey === prev)) {
        return prev;
      }
      return channelRootUnitsNewestFirst[0]!.threadKey;
    });
  }, [channelRootUnitsNewestFirst, isMdLayout]);

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
    return <p className="text-sm text-muted-foreground">No channel messages in this digest.</p>;
  }

  const threadDetailRoot = selectedUnit ? pickThreadRoot(selectedUnit) : null;
  const detailTitle = threadDetailRoot ? (
    <div className="flex min-w-0 items-center gap-2.5 pr-1">
      <Avatar
        userId={threadDetailRoot.userId}
        author={resolveTranscriptAuthor(threadDetailRoot.userId, lookup)}
      />
      <div className="min-w-0 flex-1">
        <AuthorHeading author={resolveTranscriptAuthor(threadDetailRoot.userId, lookup)} />
        <p className="line-clamp-1 text-left text-xs text-muted-foreground">
          {threadDetailRoot.body.replace(/\s+/g, " ").trim()}
        </p>
      </div>
    </div>
  ) : (
    <span className="text-sm font-medium text-muted-foreground">Thread</span>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <DigestTwoPaneShell
        isMdLayout={isMdLayout}
        detailOpen={Boolean(selectedKey)}
        onCloseDetail={dismissThreadPanel}
        detailTitle={detailTitle}
        leftScrollRef={listScrollRef}
        onLeftScroll={onListScroll}
        leftList={
          <div className="flex flex-col gap-1.5 md:gap-2" role="list" aria-label="Channel messages">
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
                <div className="flex flex-col gap-2 pb-1 md:gap-2.5" aria-label="Message replies">
                  {replies.map((r, i) => (
                    <ThreadReplyCard
                      key={r.order}
                      line={r}
                      author={resolveTranscriptAuthor(r.userId, lookup)}
                      staggerIndex={i}
                      onClose={isMdLayout && i === 0 ? dismissThreadPanel : undefined}
                      closeAriaLabel={isMdLayout && i === 0 ? "Close thread" : undefined}
                    />
                  ))}
                </div>
              ) : threadDetailRoot ? (
                <div className="flex flex-col gap-2 pb-1 md:gap-2.5" aria-label="Channel message">
                  <ThreadReplyCard
                    key={threadDetailRoot.order}
                    line={threadDetailRoot}
                    author={resolveTranscriptAuthor(threadDetailRoot.userId, lookup)}
                    staggerIndex={0}
                    onClose={isMdLayout ? dismissThreadPanel : undefined}
                    closeAriaLabel={isMdLayout ? "Close thread" : undefined}
                  />
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
    </div>
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
  const isMdLayout = useIsMdLayout();
  const lookup = useDigestAuthorLookup();
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingMessageScrollAdjustRef = useRef<{ prevH: number; prevT: number } | null>(null);

  const { columns, order } = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    const orderIds = authorColumnOrder(lines);
    const by = groupLinesByAuthor(lines);
    return { columns: by, order: orderIds };
  }, [markdown]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (order.length === 0) {
      setSelectedUserId(null);
      return;
    }
    const md = readIsMdLayoutViewport();
    setSelectedUserId((prev) => {
      if (!md) {
        if (prev && order.some((id) => id === prev)) {
          return prev;
        }
        return null;
      }
      if (prev && order.some((id) => id === prev)) {
        return prev;
      }
      // Match sidebar: `authorColumnOrder` is first appearance in digest (top row = order[0]).
      return order[0] ?? null;
    });
  }, [order, isMdLayout]);

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
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight < el.scrollHeight - AUTHOR_MESSAGES_BOTTOM_SCROLL_THRESHOLD_PX) {
        return;
      }
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
    el.scrollTop = 0;
  }, [markdown, selectedUserId]);

  const selectedMsgsNewestFirst = useMemo(() => {
    if (!selectedUserId) {
      return [] as DigestLine[];
    }
    return [...(columns.get(selectedUserId) ?? [])].reverse();
  }, [columns, selectedUserId]);

  if (order.length === 0) {
    return <p className="text-sm text-muted-foreground">No parsed messages in this digest.</p>;
  }

  const selectedAuthor = selectedUserId ? resolveTranscriptAuthor(selectedUserId, lookup) : null;
  const detailTitle = selectedUserId ? (
    <div className="flex min-w-0 items-center gap-2.5 pr-1">
      <Avatar userId={selectedUserId} author={selectedAuthor} />
      <AuthorHeading author={selectedAuthor} />
    </div>
  ) : (
    <span className="text-sm font-medium text-muted-foreground">Employee</span>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <DigestTwoPaneShell
      isMdLayout={isMdLayout}
      detailOpen={Boolean(selectedUserId)}
      onCloseDetail={dismissAuthorPanel}
      detailTitle={detailTitle}
      leftList={
        <div className="flex flex-col gap-1.5 md:gap-2" role="list" aria-label="Team">
          {order.map((uid) => {
            const msgs = columns.get(uid) ?? [];
            const author = resolveTranscriptAuthor(uid, lookup);
            return (
              <AuthorEmployeeListRow
                key={uid}
                userId={uid}
                author={author}
                messageCount={msgs.length}
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
              {selectedMsgsNewestFirst.length > 0 ? (
                <div className="flex flex-col gap-2 pb-1 md:gap-2.5" aria-label="Employee messages">
                  {selectedMsgsNewestFirst.map((line, i) => (
                    <ThreadReplyCard
                      key={line.order}
                      line={line}
                      author={resolveTranscriptAuthor(line.userId, lookup)}
                      staggerIndex={i}
                      onClose={isMdLayout && i === 0 ? dismissAuthorPanel : undefined}
                      closeAriaLabel={isMdLayout && i === 0 ? "Close author" : undefined}
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
    </div>
  );
}

/**
 * Markdown tab preview: when author lookup is populated, each digest bullet is shown as
 * avatar + display name + rendered body; otherwise falls back to plain `ReactMarkdown`.
 * Clipboard "copy markdown" should use the raw digest string (`digestMarkdownForClassic` output), not this tree.
 */
export function ClassicDigestMarkdownView({ markdown }: { markdown: string }) {
  const lookup = useDigestAuthorLookup();
  const useRich = Boolean(lookup && Object.keys(lookup).length > 0);

  if (!useRich) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
  }

  const lines = markdown.split("\n");
  return (
    <div className="not-prose flex flex-col gap-0" aria-label="Channel digest preview">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (line === "") {
          return <div key={`blank-${i}`} className="h-0.5 shrink-0" aria-hidden />;
        }
        const m = line.match(DIGEST_MARKDOWN_BULLET_LINE_RE);
        if (!m) {
          return (
            <div key={i} className="text-[13px] leading-relaxed text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{line}</ReactMarkdown>
            </div>
          );
        }
        const isReply = Boolean(m[1]);
        const userId = m[2]!.trim();
        const body = stripDigestThreadMarkers(m[3] ?? "");
        const author = resolveTranscriptAuthor(userId, lookup);
        return (
          <div key={i} className="min-w-0 py-1.5 sm:py-2">
            <div className="flex min-w-0 items-start gap-2 sm:gap-3">
              <div className="shrink-0 pt-0.5">
                <Avatar userId={userId} author={author} variant="row" />
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <AuthorHeading author={author} as="p" className="m-0 text-[13px] leading-snug" />
                  {isReply ? (
                    <span className="rounded bg-muted/80 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      reply
                    </span>
                  ) : null}
                </div>
                <DigestBodyMarkdown text={body} variant="transcript" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Classic Markdown tab: message body only (no leading `# Channel digest …` title). */
export function digestMarkdownForClassic(markdown: string): string {
  const { bodyLines } = splitDigestMarkdown(markdown);
  const strippedLines = bodyLines.map((ln) => stripDigestThreadMarkers(ln));
  return strippedLines.join("\n");
}

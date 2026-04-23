"use client";

import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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

/** Slack user id (any casing) → display + portrait; populated from server env via `/api/admin/slack-bot-author-profiles`. */
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

function AuthorHeading({ userId, author }: { userId: string; author: SlackTranscriptAuthor | null }) {
  if (author) {
    return (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-tight text-foreground" title={userId}>
          {author.displayName}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground" title={userId}>
          {userId}
        </p>
      </div>
    );
  }
  return (
    <span className="font-mono text-[11px] font-semibold text-muted-foreground" title={userId}>
      {userId}
    </span>
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

/** Reply cards sit below the parent at two-thirds of the transcript column width (Slack-ish nesting). */
function ThreadReplyCard({ line, author }: { line: DigestLine; author: SlackTranscriptAuthor | null }) {
  return (
    <div className="w-2/3 max-w-full self-start rounded-xl border border-border/90 bg-card p-3 shadow-sm">
      <div className="flex gap-3">
        <Avatar userId={line.userId} author={author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <AuthorHeading userId={line.userId} author={author} />
            {line.isReply ? (
              <span className="rounded bg-muted px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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

function ThreadUnitCard({ unit }: { unit: ThreadUnit }) {
  const lookup = useDigestAuthorLookup();
  const [open, setOpen] = useState(false);
  const root = pickThreadRoot(unit);
  const replies = unit.messages.filter((m: DigestLine) => m !== root);
  const expandable = replies.length > 0;
  const threadCount = unit.messages.length;
  const rootAuthor = resolveTranscriptAuthor(root.userId, lookup);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="w-full rounded-xl border border-border/90 bg-card p-3 shadow-sm">
        <div className="flex gap-3">
          <Avatar userId={root.userId} author={rootAuthor} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <AuthorHeading userId={root.userId} author={rootAuthor} />
              {threadCount > 1 ? (
                <span className="text-[11px] text-muted-foreground">· {threadCount} in thread</span>
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
            <DigestBodyMarkdown text={root.body} />
            {expandable ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="mt-3 flex items-center gap-1.5 rounded-md text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
                )}
                {open ? "Hide replies" : `Show ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {open && expandable ? (
        <div className="flex w-full flex-col gap-2 pt-0.5">
          {replies.map((r) => (
            <ThreadReplyCard
              key={r.order}
              line={r}
              author={resolveTranscriptAuthor(r.userId, lookup)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DigestThreadView({ markdown }: { markdown: string }) {
  const units = useMemo(() => {
    const { bodyLines } = splitDigestMarkdown(markdown);
    const lines = parseDigestBodyLines(bodyLines);
    return buildThreadUnits(lines);
  }, [markdown]);

  if (units.length === 0) {
    return <p className="text-sm text-muted-foreground">No parsed messages in this digest.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {units.map((u) => (
        <ThreadUnitCard key={`${u.threadKey}:${u.messages.map((m: DigestLine) => m.order).join("-")}`} unit={u} />
      ))}
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
                {author ? (
                  <>
                    <p className="truncate text-sm font-semibold text-foreground" title={uid}>
                      {author.displayName}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground" title={uid}>
                      {uid}
                    </p>
                  </>
                ) : (
                  <p className="truncate font-mono text-[11px] font-semibold text-foreground" title={uid}>
                    {uid}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{msgs.length} messages</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {msgs.map((line) => (
                <div
                  key={line.order}
                  className={clsx(
                    "rounded-lg border border-border/70 bg-card p-2 shadow-sm",
                    line.isReply ? "border-l-[3px] border-l-sky-500/60" : "",
                  )}
                >
                  {line.isReply ? (
                    <span className="mb-1 inline-block text-[9px] font-semibold uppercase tracking-wide text-sky-700/80 dark:text-sky-400/90">
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

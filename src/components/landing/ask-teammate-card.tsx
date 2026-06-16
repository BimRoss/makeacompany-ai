"use client";

import { Hash, Send, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

export type TeammatePersona = {
  slug: string;
  name: string;
  role: string;
  headshot: string;
  channelName: string;
  endpoint: string;
  blurb: string;
  intro: string;
  starters: string[];
};

type ChatRole = "user" | "assistant";
type ChatMessage = {
  role: ChatRole;
  content: string;
  ts: number;
};

const MAX_PERSISTED = 30;

function storageKeyFor(slug: string): string {
  return `mac.askteammate.thread.${slug}.v1`;
}

function loadPersisted(slug: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKeyFor(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ChatMessage =>
          m &&
          typeof m === "object" &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          typeof m.ts === "number",
      )
      .slice(-MAX_PERSISTED);
  } catch {
    return [];
  }
}

function persist(slug: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKeyFor(slug),
      JSON.stringify(messages.slice(-MAX_PERSISTED)),
    );
  } catch {
    // Storage may be blocked; that's fine.
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export function AskTeammateCard({ persona }: { persona: TeammatePersona }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uid = useId();
  const panelId = `ask-${persona.slug}-panel-${uid}`;
  const triggerId = `ask-${persona.slug}-trigger-${uid}`;

  useEffect(() => {
    setMessages(loadPersisted(persona.slug));
  }, [persona.slug]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText, open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const userMsg: ChatMessage = { role: "user", content: trimmed, ts: Date.now() };
      const next = [...messages, userMsg];
      setMessages(next);
      persist(persona.slug, next);
      setInput("");
      setStreamText("");
      setStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch(persona.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          if (resp.status === 429) {
            const retryRaw = resp.headers.get("Retry-After");
            const retrySec = retryRaw ? parseInt(retryRaw, 10) : NaN;
            const wait =
              Number.isFinite(retrySec) && retrySec > 0
                ? `Try again in ${retrySec}s.`
                : "Try again in a moment.";
            setError(`Too many messages back-to-back. ${wait}`);
            return;
          }
          let detail = "";
          try {
            detail = await resp.text();
          } catch {
            // ignore
          }
          throw new Error(detail || `request failed (${resp.status})`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setStreamText(acc);
        }

        const final = acc.trim();
        if (final) {
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: final,
            ts: Date.now(),
          };
          const after = [...next, assistantMsg];
          setMessages(after);
          persist(persona.slug, after);
        }
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          setError(`${persona.name} hit a snag. Try again in a moment.`);
        }
      } finally {
        setStreamText("");
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, persona.endpoint, persona.name, persona.slug, streaming],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void send(input);
    },
    [input, send],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send],
  );

  const clearThread = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    persist(persona.slug, []);
    setStreamText("");
    setError(null);
  }, [persona.slug]);

  const showStarters = messages.length === 0 && !streaming;
  const liveText = useMemo(() => streamText, [streamText]);

  return (
    <div
      data-state={open ? "open" : "closed"}
      className="ask-teammate group rounded-xl border border-border bg-card/60 transition-[border-color,background-color,box-shadow] data-[state=open]:border-foreground/25 data-[state=open]:bg-card data-[state=open]:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.1)] md:hover:border-foreground/25 md:hover:bg-card md:hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)] dark:data-[state=open]:shadow-[0_8px_30px_-8px_rgba(255,255,255,0.06)] dark:md:hover:shadow-[0_14px_44px_-12px_rgba(255,255,255,0.08)]"
    >
      {!open && (
        <button
          type="button"
          id={triggerId}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
          className="flex w-full cursor-pointer items-center gap-4 p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            <Image
              src={persona.headshot}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
            />
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-500"
            />
          </span>
          <span className="flex flex-1 flex-col gap-1">
            <span className="flex items-center gap-2 text-lg font-medium">
              Ask {persona.name}
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                online
              </span>
            </span>
            <span className="text-pretty text-sm text-muted-foreground">{persona.blurb}</span>
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
            <Hash className="h-3.5 w-3.5" aria-hidden /> open chat
          </span>
        </button>
      )}

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="flex max-h-[560px] flex-col overflow-hidden rounded-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-background/40 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Hash className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-semibold">{persona.channelName}</span>
              <span className="hidden text-muted-foreground sm:inline">
                · DM with {persona.name}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearThread}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                aria-label="Close chat"
                onClick={() => {
                  abortRef.current?.abort();
                  setOpen(false);
                }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="ask-teammate-scroll min-h-0 flex-1 overflow-y-auto bg-card px-3 py-4 sm:px-5"
          >
            {messages.length === 0 && <IntroBlock persona={persona} />}
            <ol className="space-y-4" aria-live="polite">
              {messages.map((m, i) => (
                <MessageBubble
                  key={`${m.ts}-${i}`}
                  message={m}
                  persona={persona}
                />
              ))}
              {streaming && (
                <MessageBubble
                  message={{
                    role: "assistant",
                    content: liveText,
                    ts: Date.now(),
                  }}
                  persona={persona}
                  pending
                />
              )}
            </ol>
            {error && (
              <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>

          {showStarters && (
            <div className="border-t border-border bg-background/30 px-3 py-2 sm:px-5">
              <div className="flex flex-wrap gap-2">
                {persona.starters.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="border-t border-border bg-background/40 px-3 py-3 sm:px-5"
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-foreground/40">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={`Message ${persona.name}`}
                disabled={streaming}
                className="ask-teammate-input flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                aria-label="Send message"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:opacity-90 disabled:opacity-30 ${
                  input.trim() && !streaming
                    ? "bg-emerald-500 hover:bg-emerald-600"
                    : "bg-foreground text-background"
                }`}
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Press Enter to send · Shift+Enter for a new line
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

function IntroBlock({ persona }: { persona: TeammatePersona }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-start gap-3">
        <span className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
          <Image
            src={persona.headshot}
            alt=""
            fill
            sizes="40px"
            className="object-cover"
          />
        </span>
        <div className="flex-1 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{persona.name}</span>
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              app
            </span>
            <span className="text-xs text-muted-foreground">{formatTime(Date.now())}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{persona.intro}</p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  persona,
  pending = false,
}: {
  message: ChatMessage;
  persona: TeammatePersona;
  pending?: boolean;
}) {
  const isTeammate = message.role === "assistant";
  const name = isTeammate ? persona.name : "You";
  return (
    <li className="flex items-start gap-3">
      <span
        className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted"
        aria-hidden
      >
        {isTeammate ? (
          <Image
            src={persona.headshot}
            alt=""
            fill
            sizes="40px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-foreground/10 text-sm font-semibold text-foreground">
            Y
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{name}</span>
          {isTeammate && (
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              app
            </span>
          )}
          <span className="text-xs text-muted-foreground">{formatTime(message.ts)}</span>
        </div>
        <div className="mt-0.5 break-words text-foreground">
          {isTeammate ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-pre:bg-muted prose-code:before:content-none prose-code:after:content-none">
              {message.content ? (
                <ReactMarkdown>{message.content}</ReactMarkdown>
              ) : (
                <TypingDots />
              )}
              {pending && message.content && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-foreground/60"
                />
              )}
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 align-middle text-muted-foreground"
      aria-label="typing"
    >
      <span className="h-1.5 w-1.5 animate-[ask-teammate-dot_1.2s_infinite] rounded-full bg-current" />
      <span
        className="h-1.5 w-1.5 animate-[ask-teammate-dot_1.2s_infinite] rounded-full bg-current"
        style={{ animationDelay: "0.15s" }}
      />
      <span
        className="h-1.5 w-1.5 animate-[ask-teammate-dot_1.2s_infinite] rounded-full bg-current"
        style={{ animationDelay: "0.3s" }}
      />
    </span>
  );
}

export const ROSS_PERSONA: TeammatePersona = {
  slug: "ross",
  name: "Ross",
  role: "AI Software Developer",
  headshot: "/headshots/ross.png",
  channelName: "ask-ross",
  endpoint: "/api/ask-ross",
  blurb:
    "Chat with our AI Software Developer in a Slack-style window. Ask what he ships, how PRs work, or how to get started.",
  intro:
    "Hey — I'm Ross. I ship the code side of makeacompany.ai. Ask me anything about the product, what I do in your Slack, or how to get started.",
  starters: [
    "How does this actually work?",
    "What can you ship in a day?",
    "How do I get started?",
  ],
};

export const JOANNE_PERSONA: TeammatePersona = {
  slug: "joanne",
  name: "Joanne",
  role: "AI Chief of Staff",
  headshot: "/headshots/joanne.png",
  channelName: "ask-joanne",
  endpoint: "/api/ask-joanne",
  blurb:
    "Chat with our AI Chief of Staff in a Slack-style window. Ask about the ops side, customer email, scheduling, or onboarding.",
  intro:
    "Hi — I'm Joanne. I run the ops side of makeacompany.ai. Ask me anything about how onboarding works, what I handle in your Slack, or how to get started.",
  starters: [
    "What do you actually handle?",
    "Will you send emails for me?",
    "How does onboarding work?",
  ],
};

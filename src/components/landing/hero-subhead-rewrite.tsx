"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { siteDescriptionLine2 } from "@/lib/site";

const DEFAULT_TEXT = siteDescriptionLine2;

type Voice = "joanne" | "ross" | "duo";

// Longest known subhead string — also used as an invisible height anchor below
// so the surrounding container reserves the same number of lines for every
// variant. Re-pick this if you add a longer entry to VARIANTS.
const HEIGHT_ANCHOR =
  "10 minutes to scope. Same day to shipped. $99/mo instead of $3–5K in contractors. The ROI shows up in the first week.";

const VARIANTS: ReadonlyArray<{ voice: Voice; text: string }> = [
  {
    voice: "joanne",
    text:
      "I'm Joanne. Send me the emails, follow-ups, and calendar chaos. I'll handle the rest and only ping you when it matters.",
  },
  {
    voice: "joanne",
    text:
      "I run ops so you can run the company. Customer replies, updates, vendor pings, calendar Tetris. Drop it in Slack. Done.",
  },
  {
    voice: "ross",
    text:
      "I'm Ross. Describe what you want built. I'll ship it. Real repo, real PRs, real code.",
  },
  {
    voice: "ross",
    text:
      "Message me what to ship. PR up the same hour, tests included. You review and merge.",
  },
  {
    voice: "duo",
    text:
      "Joanne runs ops. Ross writes code. You make the calls only a founder can. It's basically a whole company in your Slack, for what Claude Code costs.",
  },
  {
    voice: "duo",
    text:
      "A Chief of Staff and a Developer, living in your Slack. Nothing to set up. Two new DMs and a whole company at your fingertips.",
  },
  {
    voice: "duo",
    text:
      "10 minutes to scope. Same day to shipped. $99/mo instead of $3–5K in contractors. The ROI shows up in the first week.",
  },
  {
    voice: "duo",
    text:
      "Your next hire costs $150K/yr. These two cost $99/mo and start today.",
  },
];

const ERASE_MS = 10;
const TYPE_MS = 20;

interface Props {
  onAgentChange?: (agent: "joanne" | "ross" | null) => void;
}

export function HeroSubheadRewrite({ onAgentChange }: Props) {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastVoice, setLastVoice] = useState<Voice | null>(null);
  const textRef = useRef(DEFAULT_TEXT);
  const cancelRef = useRef<(() => void) | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const setT = useCallback((v: string) => {
    textRef.current = v;
    setText(v);
  }, []);

  const animateTo = useCallback(
    (target: string) => {
      cancelRef.current?.();

      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) {
        setT(target);
        return;
      }

      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      cancelRef.current = () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        setTyping(false);
      };

      const tick = (fn: () => void, delay: number) => {
        const t = setTimeout(() => {
          if (!cancelled) fn();
        }, delay);
        timers.push(t);
      };

      const current = textRef.current;
      let prefix = 0;
      while (
        prefix < current.length &&
        prefix < target.length &&
        current[prefix] === target[prefix]
      ) {
        prefix++;
      }

      let delay = 0;
      setTyping(true);
      for (let i = current.length - 1; i >= prefix; i--) {
        const val = current.slice(0, i);
        tick(() => setT(val), delay);
        delay += ERASE_MS;
      }
      for (let i = prefix + 1; i <= target.length; i++) {
        const val = target.slice(0, i);
        tick(() => setT(val), delay);
        delay += TYPE_MS;
      }
      tick(() => setTyping(false), delay);
    },
    [setT],
  );

  const fallbackVariant = useCallback((voice: Voice): string => {
    const pool = VARIANTS.filter((v) => v.voice === voice);
    return pool[Math.floor(Math.random() * pool.length)].text;
  }, []);

  const cycleNext = useCallback(async () => {
    setPending(true);
    cancelRef.current?.();
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    setLoading(true);

    const voices: Voice[] = ["joanne", "ross", "duo"];
    let voice = voices[Math.floor(Math.random() * voices.length)];
    while (voice === lastVoice) {
      voice = voices[Math.floor(Math.random() * voices.length)];
    }
    setLastVoice(voice);
    onAgentChange?.(voice === "duo" ? null : voice);

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fetchPromise = fetch("/api/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice }),
      signal: ctrl.signal,
    });

    try {
      const resp = await fetchPromise;
      if (!resp.ok || !resp.body) throw new Error(`rewrite ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let started = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        acc += chunk;
        if (!started) {
          started = true;
          setPending(false);
          if (!reduce) {
            setT("");
            setTyping(true);
          }
        }
        if (!reduce) setT(acc);
      }

      const cleaned = acc
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (ctrl.signal.aborted) return;
      if (!started || !cleaned) {
        animateTo(fallbackVariant(voice));
      } else {
        setT(cleaned);
      }
      setTyping(false);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setPending(false);
      animateTo(fallbackVariant(voice));
    } finally {
      if (inflightRef.current === ctrl) {
        inflightRef.current = null;
        setLoading(false);
        setPending(false);
      }
    }
  }, [animateTo, fallbackVariant, lastVoice, onAgentChange, setT]);

  useEffect(
    () => () => {
      cancelRef.current?.();
      inflightRef.current?.abort();
    },
    [],
  );

  return (
    <div className="mx-auto mb-6 flex w-full max-w-4xl flex-col items-center gap-3 sm:mb-10 sm:gap-4">
      <div className="grid w-full">
        <p
          aria-hidden
          className="invisible col-start-1 row-start-1 text-pretty text-center text-lg font-medium leading-relaxed sm:text-xl md:text-2xl"
        >
          {HEIGHT_ANCHOR}
        </p>
        <p
          className={`col-start-1 row-start-1 text-pretty text-center text-lg font-medium leading-relaxed transition-colors duration-200 sm:text-xl md:text-2xl ${typing || pending ? "text-muted-foreground/40" : "text-muted-foreground"}`}
        >
          {text}
          {typing ? (
            <span
              className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground/70"
              aria-hidden
            >
              |
            </span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={cycleNext}
        disabled={loading}
        aria-label="Tell me more about Joanne and Ross"
        className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground hover:bg-muted hover:text-foreground active:border-foreground active:bg-muted active:text-foreground disabled:opacity-70 sm:px-3.5 sm:py-1.5 sm:text-sm"
      >
        <Sparkles
          className={`h-3.5 w-3.5 transition-transform group-hover:scale-110 group-active:scale-110 sm:h-4 sm:w-4 ${loading ? "animate-pulse" : ""}`}
          aria-hidden
        />
        <span>{loading ? "Thinking…" : "Tell me more"}</span>
      </button>
    </div>
  );
}

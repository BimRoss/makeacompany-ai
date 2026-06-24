"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeroBuildQuoteRotator } from "@/components/landing/hero-build-quote-rotator";
import { JoinSlackCta } from "@/components/landing/join-slack-cta";
import { PersonaSelector } from "@/components/landing/persona-selector";
import { usePersona } from "@/components/landing/persona-context";
import { TaoSlackSignalBadges } from "@/components/landing/tao-slack-signal-badges";

const AGENT_LINES = {
  joanne: { line1: "Joanne", line2: "Chief of Staff" },
  ross: { line1: "Ross", line2: "Software Developer" },
} as const;

const ERASE_MS = 22;
const TYPE_MS = 42;

export function HeroSection() {
  const { copy, selected } = usePersona();
  const heroLine1 = selected ? copy.heroLine1 : "An AI team that runs";
  const heroLine2 = selected ? copy.heroLine2 : "your company in Slack.";
  const personaDefault = { line1: heroLine1, line2: heroLine2 };

  // Caret position is the only piece of typing state React needs to track.
  // The displayed text is written directly to the DOM via refs below — that
  // bypasses ~40 React re-renders per typed word, which was the real cost.
  const [caretAt, setCaretAt] = useState<1 | 2 | null>(null);
  const l1Ref = useRef(personaDefault.line1);
  const l2Ref = useRef(personaDefault.line2);
  const l1ElRef = useRef<HTMLSpanElement | null>(null);
  const l2ElRef = useRef<HTMLSpanElement | null>(null);
  // Frozen on first render so React never reconciles the text spans after
  // mount. Subsequent text changes go through textContent writes only.
  const initialL1 = useRef(personaDefault.line1);
  const initialL2 = useRef(personaDefault.line2);
  const cancelRef = useRef<(() => void) | null>(null);
  const hoverAgentRef = useRef<"joanne" | "ross" | null>(null);
  const firstLoadRef = useRef(true);

  const setL1 = useCallback((v: string) => {
    l1Ref.current = v;
    if (l1ElRef.current) l1ElRef.current.textContent = v || " ";
  }, []);

  const setL2 = useCallback((v: string) => {
    l2Ref.current = v;
    if (l2ElRef.current) l2ElRef.current.textContent = v || " ";
  }, []);

  const animateTo = useCallback(
    (target: { line1: string; line2: string }) => {
      cancelRef.current?.();

      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) {
        setL1(target.line1);
        setL2(target.line2);
        setCaretAt(null);
        return;
      }

      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      cancelRef.current = () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        setCaretAt(null);
      };

      function tick(fn: () => void, delay: number) {
        const t = setTimeout(() => {
          if (!cancelled) fn();
        }, delay);
        timers.push(t);
      }

      function animateLine(
        setter: (v: string) => void,
        current: string,
        next: string,
        onFirstType?: () => void,
      ): number {
        let prefix = 0;
        while (
          prefix < current.length &&
          prefix < next.length &&
          current[prefix] === next[prefix]
        ) {
          prefix++;
        }
        let delay = 0;
        for (let i = current.length - 1; i >= prefix; i--) {
          const val = current.slice(0, i);
          tick(() => setter(val), delay);
          delay += ERASE_MS;
        }
        let firedFirst = false;
        for (let i = prefix + 1; i <= next.length; i++) {
          const val = next.slice(0, i);
          tick(() => {
            setter(val);
            if (!firedFirst) {
              firedFirst = true;
              onFirstType?.();
            }
          }, delay);
          delay += TYPE_MS;
        }
        return delay;
      }

      setCaretAt(1);
      const dur1 = animateLine(setL1, l1Ref.current, target.line1);
      const dur2 = animateLine(setL2, l2Ref.current, target.line2, () => {
        setCaretAt(2);
      });
      tick(() => setCaretAt(null), Math.max(dur1, dur2));
    },
    [setL1, setL2],
  );

  const onHoverChange = useCallback(
    (agent: "joanne" | "ross" | null) => {
      hoverAgentRef.current = agent;
      const effective = agent;
      const target = effective
        ? AGENT_LINES[effective]
        : { line1: heroLine1, line2: heroLine2 };
      animateTo(target);
    },
    [animateTo, heroLine1, heroLine2],
  );

  // Retarget the H1 when the selected persona changes (only when no
  // joanne/ross hover is active — that wins over the persona default).
  useEffect(() => {
    if (hoverAgentRef.current) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      // SSR rendered the full lines; clear back to blank so the first
      // paint animates in from empty rather than no-opping.
      setL1("");
      setL2("");
      animateTo({ line1: heroLine1, line2: heroLine2 });
      return;
    }
    // Persona switch: snap to the new text. The typewriter erase+retype
    // races with mid-animation taps and visibly flickers the final chars
    // (seen as "harne → harness" on Engineers).
    cancelRef.current?.();
    setCaretAt(null);
    setL1(heroLine1);
    setL2(heroLine2);
  }, [animateTo, heroLine1, heroLine2, setL1, setL2]);

  useEffect(() => () => cancelRef.current?.(), []);

  return (
    <section id="start" className="relative flex w-full min-h-0 flex-col items-center justify-start px-4 pb-8 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:pb-24 lg:pt-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl text-center">
        <div className="mb-6 flex justify-center sm:mb-8">
          <PersonaSelector />
        </div>

        <h1 className="mx-auto mb-4 flex min-h-[3.5rem] max-w-none flex-col items-center justify-center whitespace-nowrap text-balance text-[1.375rem] font-bold leading-[1.1] tracking-tight text-foreground sm:mb-6 sm:min-h-[7rem] sm:text-5xl sm:leading-[1.06] md:min-h-[8rem] md:text-6xl lg:min-h-[10rem] lg:text-7xl">
          <span className="block">
            <span ref={l1ElRef}>{initialL1.current || " "}</span>
            {caretAt === 1 ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
          <span className="block">
            <span ref={l2ElRef}>{initialL2.current || " "}</span>
            {caretAt === 2 ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
        </h1>

        <HeroBuildQuoteRotator />

        <div className="mb-6 flex w-full justify-center sm:mb-10">
          <TaoSlackSignalBadges onHoverChange={onHoverChange} />
        </div>

        <JoinSlackCta label={copy.ctaButtonLabel} />

        <p className="mx-auto mt-3 max-w-xl text-balance text-xs text-muted-foreground sm:mt-3.5 sm:text-sm">
          Click the button. You&apos;ll be in our Slack with Ross and Joanne in 60 seconds.
        </p>
      </div>
    </section>
  );
}

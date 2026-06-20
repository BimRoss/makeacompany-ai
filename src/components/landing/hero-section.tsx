"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeroBuildQuoteRotator } from "@/components/landing/hero-build-quote-rotator";
import { HeroJoanneInviteCard } from "@/components/landing/hero-joanne-invite-card";
import { HeroSubheadRewrite } from "@/components/landing/hero-subhead-rewrite";
import { EmailCaptureForm } from "@/components/landing/email-capture-form";
import { PersonaSelector } from "@/components/landing/persona-selector";
import { PricingCliffLine } from "@/components/landing/pricing-cliff-line";
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
  const heroLine1 = selected ? copy.heroLine1 : "The future of work.";
  const heroLine2 = selected ? copy.heroLine2 : "Where it already happens.";
  const personaDefault = { line1: heroLine1, line2: heroLine2 };

  const [displayLine1, setDisplayLine1] = useState(personaDefault.line1);
  const [displayLine2, setDisplayLine2] = useState(personaDefault.line2);
  const [typing, setTyping] = useState(false);
  const [forcedAgent, setForcedAgent] = useState<"joanne" | "ross" | null>(null);
  const l1Ref = useRef(personaDefault.line1);
  const l2Ref = useRef(personaDefault.line2);
  const cancelRef = useRef<(() => void) | null>(null);
  const forcedAgentRef = useRef<"joanne" | "ross" | null>(null);
  const hoverAgentRef = useRef<"joanne" | "ross" | null>(null);
  const firstLoadRef = useRef(true);

  const setL1 = useCallback((v: string) => {
    l1Ref.current = v;
    setDisplayLine1(v);
  }, []);

  const setL2 = useCallback((v: string) => {
    l2Ref.current = v;
    setDisplayLine2(v);
  }, []);

  const animateTo = useCallback(
    (target: { line1: string; line2: string }) => {
      cancelRef.current?.();

      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) {
        setL1(target.line1);
        setL2(target.line2);
        return;
      }

      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      cancelRef.current = () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        setTyping(false);
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
        for (let i = prefix + 1; i <= next.length; i++) {
          const val = next.slice(0, i);
          tick(() => setter(val), delay);
          delay += TYPE_MS;
        }
        return delay;
      }

      setTyping(true);
      const dur1 = animateLine(setL1, l1Ref.current, target.line1);
      const dur2 = animateLine(setL2, l2Ref.current, target.line2);
      tick(() => setTyping(false), Math.max(dur1, dur2));
    },
    [setL1, setL2],
  );

  const onHoverChange = useCallback(
    (agent: "joanne" | "ross" | null) => {
      hoverAgentRef.current = agent;
      const effective = agent ?? forcedAgentRef.current;
      const target = effective
        ? AGENT_LINES[effective]
        : { line1: heroLine1, line2: heroLine2 };
      animateTo(target);
    },
    [animateTo, heroLine1, heroLine2],
  );

  const onRewriteAgentChange = useCallback(
    (agent: "joanne" | "ross" | null) => {
      forcedAgentRef.current = agent;
      setForcedAgent(agent);
      onHoverChange(agent);
    },
    [onHoverChange],
  );

  // Retarget the H1 when the selected persona changes (only when no
  // joanne/ross override is active — those win over the persona default).
  useEffect(() => {
    if (hoverAgentRef.current || forcedAgentRef.current) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      // SSR rendered the full lines; clear back to blank so the first
      // paint animates in from empty rather than no-opping.
      setL1("");
      setL2("");
    }
    animateTo({ line1: heroLine1, line2: heroLine2 });
  }, [animateTo, heroLine1, heroLine2, setL1, setL2]);

  useEffect(() => () => cancelRef.current?.(), []);

  return (
    <section className="relative flex w-full min-h-0 flex-col items-center justify-start px-4 pb-4 pt-8 sm:min-h-screen sm:px-6 sm:pb-14 sm:pt-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl text-center">
        <div className="mb-4 flex justify-center sm:mb-6">
          <PricingCliffLine />
        </div>

        <div className="mb-6 flex justify-center sm:mb-8">
          <PersonaSelector />
        </div>

        <h1 className="mx-auto mb-6 flex min-h-[4.5rem] max-w-none flex-col items-center justify-center text-balance text-3xl font-bold leading-[1.1] tracking-tight text-foreground sm:mb-10 sm:min-h-[7rem] xl:whitespace-nowrap sm:text-5xl sm:leading-[1.06] md:min-h-[8rem] md:text-6xl lg:min-h-[10rem] lg:text-7xl">
          <span className="block xl:whitespace-nowrap">
            {displayLine1 || " "}
            {typing && l2Ref.current === "" ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
          <span className="block xl:whitespace-nowrap">
            {displayLine2 || " "}
            {typing && l2Ref.current !== "" ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
        </h1>

        <HeroBuildQuoteRotator />

        <div className="mb-6 flex w-full justify-center sm:mb-10">
          <TaoSlackSignalBadges onHoverChange={onHoverChange} forcedActive={forcedAgent} />
        </div>

        <HeroSubheadRewrite onAgentChange={onRewriteAgentChange} />

        <EmailCaptureForm submitLabel={copy.ctaButtonLabel} />

        <HeroJoanneInviteCard />
      </div>
    </section>
  );
}

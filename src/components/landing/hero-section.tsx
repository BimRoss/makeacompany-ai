"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { CheckoutButton } from "@/components/landing/checkout-button";
import { HeroJoanneInviteCard } from "@/components/landing/hero-joanne-invite-card";
import { HeroSubheadRewrite } from "@/components/landing/hero-subhead-rewrite";
import { TaoSlackSignalBadges } from "@/components/landing/tao-slack-signal-badges";
import { siteTaglineLine1, siteTaglineLine2 } from "@/lib/site";

const DEFAULT = { line1: siteTaglineLine1, line2: siteTaglineLine2 };
const AGENT_LINES = {
  joanne: { line1: "Joanne", line2: "Chief of Staff" },
  ross: { line1: "Ross", line2: "Software Developer" },
} as const;

const ERASE_MS = 22;
const TYPE_MS = 42;

export function HeroSection() {
  const [displayLine1, setDisplayLine1] = useState(DEFAULT.line1);
  const [displayLine2, setDisplayLine2] = useState(DEFAULT.line2);
  const [typing, setTyping] = useState(false);
  const [forcedAgent, setForcedAgent] = useState<"joanne" | "ross" | null>(null);
  const l1Ref = useRef(DEFAULT.line1);
  const l2Ref = useRef(DEFAULT.line2);
  const cancelRef = useRef<(() => void) | null>(null);

  const setL1 = useCallback((v: string) => {
    l1Ref.current = v;
    setDisplayLine1(v);
  }, []);

  const setL2 = useCallback((v: string) => {
    l2Ref.current = v;
    setDisplayLine2(v);
  }, []);

  const onHoverChange = useCallback((agent: "joanne" | "ross" | null) => {
    cancelRef.current?.();

    const effective = agent ?? forcedAgent;
    const target = effective ? AGENT_LINES[effective] : DEFAULT;

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
      // Keep common prefix — only erase/type the diff
      let prefix = 0;
      while (
        prefix < current.length &&
        prefix < next.length &&
        current[prefix] === next[prefix]
      ) {
        prefix++;
      }
      let delay = 0;
      // Erase from end back to prefix
      for (let i = current.length - 1; i >= prefix; i--) {
        const val = current.slice(0, i);
        tick(() => setter(val), delay);
        delay += ERASE_MS;
      }
      // Type from prefix forward to next
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
  }, [setL1, setL2, forcedAgent]);

  const onRewriteAgentChange = useCallback(
    (agent: "joanne" | "ross" | null) => {
      setForcedAgent(agent);
      onHoverChange(agent);
    },
    [onHoverChange],
  );

  // Cleanup on unmount
  useEffect(() => () => cancelRef.current?.(), []);

  return (
    <section className="relative flex w-full min-h-0 flex-col items-center justify-start px-4 pb-4 pt-8 sm:min-h-screen sm:justify-center sm:px-6 sm:pb-14 sm:pt-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl text-center">
        <div className="mb-4 flex justify-center sm:mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-foreground bg-background px-3 py-1.5 text-xs text-foreground sm:px-4 sm:py-2 sm:text-sm">
            <Sparkles className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
            <span>Meet Joanne + Ross — your AI team in Slack</span>
          </div>
        </div>

        <h1 className="mx-auto mb-6 max-w-none text-4xl font-bold leading-[1.08] tracking-tight text-foreground whitespace-nowrap sm:mb-10 sm:text-5xl sm:leading-[1.06] md:text-6xl lg:text-7xl">
          <span className="block sm:whitespace-nowrap">
            {displayLine1 || " "}
            {typing && l2Ref.current === "" ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
          <span className="block sm:whitespace-nowrap">
            {displayLine2 || " "}
            {typing && l2Ref.current !== "" ? (
              <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>|</span>
            ) : null}
          </span>
        </h1>

        <div className="mb-6 flex w-full justify-center sm:mb-10">
          <TaoSlackSignalBadges onHoverChange={onHoverChange} forcedActive={forcedAgent} />
        </div>

        <HeroSubheadRewrite onAgentChange={onRewriteAgentChange} />

        <div className="mb-4 flex justify-center sm:mb-6">
          <p className="inline-flex items-center rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-semibold tracking-tight text-foreground sm:px-5 sm:text-base">
            <span className="sm:hidden">$99/mo · Claude Code, zero setup.</span>
            <span className="hidden sm:inline">$99/mo · Claude Code, hosted in your Slack — zero setup, anywhere.</span>
          </p>
        </div>

        <CheckoutButton label="Start Building" />

        <HeroJoanneInviteCard />
      </div>
    </section>
  );
}

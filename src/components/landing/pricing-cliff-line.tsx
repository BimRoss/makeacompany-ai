"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const FALLBACK_CLAIMED = 20;
const FALLBACK_CAP = 100;
const ANIMATION_MS = 1400;

export type PricingCliffLineProps = {
  /** Live seats claimed from the backend; null/undefined falls back to the static constant. */
  claimed?: number | null;
  /** Seat cap; defaults to 100. */
  cap?: number | null;
};

export function PricingCliffLine({ claimed, cap }: PricingCliffLineProps = {}) {
  const shownClaimed = typeof claimed === "number" && claimed > 0 ? claimed : FALLBACK_CLAIMED;
  const shownCap = typeof cap === "number" && cap > 0 ? cap : FALLBACK_CAP;
  const targetPct = Math.min(100, (shownClaimed / shownCap) * 100);

  const [displayed, setDisplayed] = useState(0);
  const [pct, setPct] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(shownClaimed);
      setPct(targetPct);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(shownClaimed * eased));
      setPct(targetPct * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shownClaimed, targetPct]);

  return (
    <div className="relative inline-flex max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-foreground bg-background px-3 py-1.5 text-[11px] text-foreground sm:px-4 sm:py-2 sm:text-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-foreground/10"
        style={{ width: `${pct}%` }}
      />
      <Sparkles className="relative h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
      <span className="relative">
        <span className="font-semibold tabular-nums">{displayed} of {shownCap}</span> <span className="font-semibold">free-for-life</span> seats, then a free week, then $99/mo.
      </span>
    </div>
  );
}

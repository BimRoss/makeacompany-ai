"use client";

import { useEffect, useRef, useState } from "react";
import { usePersona } from "@/components/landing/persona-context";
import { BUILD_QUOTES, NEUTRAL_BUILD_QUOTES } from "@/lib/persona-build-quotes";

const ROTATE_MS = 3300;
const FADE_MS = 220;

export function HeroBuildQuoteRotator() {
  const { persona, selected } = usePersona();
  const quotes = selected ? BUILD_QUOTES[persona] : NEUTRAL_BUILD_QUOTES;

  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    setIndex(0);
    setVisible(true);
  }, [persona, selected]);

  useEffect(() => {
    if (reducedMotion || paused) return;
    if (quotes.length <= 1) return;

    rotateTimer.current = setTimeout(() => {
      setVisible(false);
      fadeTimer.current = setTimeout(() => {
        setIndex((i) => (i + 1) % quotes.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);

    return () => {
      if (rotateTimer.current) clearTimeout(rotateTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [index, paused, reducedMotion, quotes.length]);

  const current = quotes[index] ?? quotes[0];
  if (!current) return null;

  return (
    <div
      className="mx-auto mb-5 flex min-h-[5rem] max-w-3xl items-center justify-center px-4 text-center sm:mb-7 sm:min-h-[4.5rem]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p
        className="text-balance text-base text-muted-foreground sm:text-lg"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-out`,
        }}
        aria-live="polite"
      >
        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          Built with us:
        </span>
        <span className="text-foreground">&ldquo;{current.text}&rdquo;</span>
        {current.productName ? (
          <>
            {" "}
            <em className="text-muted-foreground/80">{current.productName}</em>
          </>
        ) : null}
      </p>
    </div>
  );
}

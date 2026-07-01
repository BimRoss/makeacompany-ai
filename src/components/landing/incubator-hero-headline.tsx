"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TYPE_MS = 36;
const START_DELAY_MS = 260;

// useLayoutEffect on the client (runs before paint, so there's no flash of the
// full headline), useEffect on the server (React would warn otherwise).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Types the hero headline out on first paint, like the classic lander. The full
 * text is server-rendered inside the heading (so crawlers and no-JS visitors
 * get the real H1), then on mount the height is locked and the text retypes
 * character by character with a blinking caret. Honors prefers-reduced-motion
 * by leaving the full headline in place.
 */
export function IncubatorHeroHeadline({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [typing, setTyping] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    const heading = headingRef.current;
    const span = textRef.current;
    if (!heading || !span) return;

    // Lock the box to the fully-rendered headline height so retyping never
    // reflows the content below it.
    heading.style.minHeight = `${heading.offsetHeight}px`;
    span.textContent = "";
    setTyping(true);

    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      span.textContent = text.slice(0, i);
      if (i < text.length) {
        timer = setTimeout(tick, TYPE_MS);
      } else {
        setTyping(false);
      }
    };
    timer = setTimeout(tick, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <h1 ref={headingRef} className={className}>
      <span ref={textRef}>{text}</span>
      <span
        aria-hidden
        className="mac-hero-caret ml-1 inline-block w-[3px] rounded-[1px] bg-current align-baseline"
        style={{
          height: "0.82em",
          opacity: typing ? 1 : 0,
          animation: typing ? "mac-caret-blink 1s steps(1) infinite" : "none",
        }}
      />
    </h1>
  );
}

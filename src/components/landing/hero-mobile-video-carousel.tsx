"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SLIDES = [
  {
    src: "/hero-create-company.mp4",
    label: "Create a company channel from Slack",
  },
  {
    src: "/hero-create-doc.mp4",
    label: "Draft a doc with Joanne in Slack",
  },
] as const;

export function HeroMobileVideoCarousel() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [active, setActive] = useState(0);

  const syncActiveFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.min(Math.max(i, 0), SLIDES.length - 1));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncActiveFromScroll();
    el.addEventListener("scroll", syncActiveFromScroll, { passive: true });
    const ro = new ResizeObserver(() => syncActiveFromScroll());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncActiveFromScroll);
      ro.disconnect();
    };
  }, [syncActiveFromScroll]);

  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active) {
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, [active]);

  const goTo = (index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border/40 bg-card shadow-2xl">
      <div
        ref={scrollerRef}
        className="flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="region"
        aria-roledescription="carousel"
        aria-label="Product demos in Slack"
      >
        {SLIDES.map((slide, i) => (
          <div
            key={slide.src}
            className="flex w-full min-w-0 shrink-0 grow-0 basis-full snap-center snap-always"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}: ${slide.label}`}
          >
            <div className="relative flex w-full min-w-0 justify-center bg-muted/20">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- marketing mute demo */}
              <video
                ref={(el) => {
                  videoRefs.current[i] = el;
                }}
                src={slide.src}
                muted
                playsInline
                loop
                preload={i === 0 ? "auto" : "metadata"}
                className="h-auto max-h-[min(72vh,620px)] w-full max-w-full object-contain object-top"
                aria-label={slide.label}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/15 to-transparent" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-2 py-3" role="tablist" aria-label="Choose demo">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-label={`Show: ${slide.label}`}
            onClick={() => goTo(i)}
            className={`h-2 rounded-full transition-all duration-200 ${
              active === i ? "w-6 bg-foreground" : "w-2 bg-muted-foreground/45 hover:bg-muted-foreground/70"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

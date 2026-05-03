"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

export type HeroMobileVideoCarouselProps = {
  className?: string;
  videoClassName?: string;
};

const SLIDES = [
  {
    src: "/hero-create-company.mp4",
    label: "Create a company channel from Slack",
  },
  {
    src: "/hero-create-doc.mp4",
    label: "Draft a doc with Joanne in Slack",
  },
  {
    src: "/hero-mobile-slide-3.mp4",
    label: "Your AI team in Slack",
  },
] as const;

export function HeroMobileVideoCarousel({
  className,
  videoClassName,
}: HeroMobileVideoCarouselProps = {}) {
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

  /** Reinforce snap after momentum ends (scrollend); CSS snap can settle slightly off on some WebKit builds. */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const snapNearest = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const idx = Math.round(el.scrollLeft / w);
      const clamped = Math.min(Math.max(idx, 0), SLIDES.length - 1);
      const target = clamped * w;
      if (Math.abs(el.scrollLeft - target) > 0.5) {
        el.scrollTo({ left: target });
      }
      syncActiveFromScroll();
    };
    el.addEventListener("scrollend", snapNearest);
    return () => el.removeEventListener("scrollend", snapNearest);
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
    <div className={clsx("w-full min-w-0 overflow-hidden", className)}>
      <div
        ref={scrollerRef}
        className="flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [touch-action:pan-x_pan-y] [&::-webkit-scrollbar]:hidden"
        role="region"
        aria-roledescription="carousel"
        aria-label="Product demos in Slack"
      >
        {SLIDES.map((slide, i) => (
          <div
            key={slide.src}
            className="flex w-full min-w-0 shrink-0 grow-0 basis-full snap-center snap-always snap-stop-always"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}: ${slide.label}`}
          >
            <div className="relative flex w-full min-w-0 justify-center bg-transparent leading-none">
              <video
                ref={(el) => {
                  videoRefs.current[i] = el;
                }}
                src={slide.src}
                muted
                playsInline
                loop
                preload={i === 0 ? "auto" : "metadata"}
                className={clsx(
                  // inset() crops a few px of encoded overscan (black bars) without re-encoding
                  // pointer-events-none: touches hit the scroll parent so vertical page scroll + horizontal carousel pan both work
                  "pointer-events-none block h-auto w-full max-w-full bg-background object-contain object-top [clip-path:inset(5px_0)] [-webkit-tap-highlight-color:transparent]",
                  videoClassName ?? "max-h-[min(72vh,620px)]",
                )}
                aria-label={slide.label}
              />
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
              active === i ? "w-6 bg-foreground" : "w-2 bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

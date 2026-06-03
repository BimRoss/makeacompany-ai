"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LanderTestimonial } from "@/lib/lander-testimonials";

// Six low-saturation tints that fit the monochrome theme. Each entry is
// [light-mode bg, dark-mode bg] — picked deterministically per name so the
// same person always lands on the same swatch.
const MONOGRAM_TINTS: ReadonlyArray<readonly [string, string]> = [
  ["#f5f5f5", "#1f1f1f"],
  ["#efeae3", "#231f1a"],
  ["#e9ecef", "#1a1d20"],
  ["#eef0ec", "#1c1f1a"],
  ["#f1ece9", "#211d1a"],
  ["#e8eaee", "#191b1f"],
];

function pickMonogramTint(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return [...MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length]];
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Renders content that may contain bullet lines (starting with •) as a proper
// <ul>/<li> list, with any non-bullet paragraphs rendered as <p> elements.
function TestimonialContent({ content, clamp }: { content: string; clamp?: boolean }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className={clamp ? "line-clamp-5" : undefined}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter(Boolean);
        const isList = lines.every((l) => l.startsWith("•"));
        if (isList) {
          return (
            <ul key={bi} className="mb-2 space-y-0.5 list-none pl-0">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-1.5">
                  <span className="select-none text-foreground/40">•</span>
                  <span>{l.replace(/^•\s*/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={bi} className="mb-2 last:mb-0">{block}</p>;
      })}
    </div>
  );
}

export function TestimonialsCarousel({ testimonials }: { testimonials: LanderTestimonial[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const activeIndex = activeId ? testimonials.findIndex((t) => t.id === activeId) : -1;
  const activeTestimonial = activeIndex >= 0 ? testimonials[activeIndex] : null;
  const goToOffset = useCallback(
    (offset: number) => {
      if (activeIndex < 0) return;
      const next = (activeIndex + offset + testimonials.length) % testimonials.length;
      setActiveId(testimonials[next].id);
    },
    [activeIndex, testimonials],
  );
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef(0);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState, testimonials.length]);

  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveId(null);
      else if (e.key === "ArrowRight") goToOffset(1);
      else if (e.key === "ArrowLeft") goToOffset(-1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [activeId, goToOffset]);

  const scrollByDirection = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    // Step by the visible width of one card (incl. gap) so a click reveals the next card cleanly.
    const card = el.querySelector<HTMLElement>("[data-testimonial-card]");
    const gap = 16; // matches gap-4
    const step = (card?.offsetWidth ?? el.clientWidth * 0.8) + gap;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  if (testimonials.length === 0) return null;

  return (
    <section className="bg-muted/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Early users are already seeing results
          </h2>
          <p className="text-lg text-muted-foreground">
            Here&apos;s what beta testers are saying about makeacompany.ai
          </p>
        </div>

        <div className="relative mx-2 sm:mx-4">
          <div
            ref={scrollRef}
            className="-mx-4 flex gap-4 overflow-x-auto overscroll-x-contain px-4 py-6 sm:-mx-2 sm:px-2 snap-x snap-mandatory scroll-smooth"
            style={{ touchAction: "pan-x" }}
            role="region"
            aria-label="Testimonials"
          >
            {testimonials.map((testimonial) => {
              const [tintLight, tintDark] = pickMonogramTint(testimonial.name);
              const initials = testimonial.avatar || deriveInitials(testimonial.name);
              return (
                <article
                  key={testimonial.id}
                  data-testimonial-card
                  tabIndex={0}
                  role="button"
                  aria-label={`Read full testimonial from ${testimonial.name}`}
                  onClick={() => setActiveId(testimonial.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveId(testimonial.id);
                    }
                  }}
                  className="testimonial-card group/card flex shrink-0 snap-start w-[85%] max-w-[360px] sm:w-[340px] lg:w-[360px] min-h-[280px] cursor-pointer flex-col rounded-xl border border-border bg-card/60 p-6 hover:border-foreground/30 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
                >
                  <div className="mb-1 text-3xl font-black leading-none text-foreground/15 select-none">&ldquo;</div>
                  <div className="mb-6 text-foreground/90 text-sm">
                    <TestimonialContent content={testimonial.content} clamp />
                  </div>
                  <div className="mt-auto flex items-center gap-3">
                    <div
                      className="testimonial-monogram relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-sm font-semibold"
                      style={
                        {
                          "--monogram-bg-light": tintLight,
                          "--monogram-bg-dark": tintDark,
                        } as React.CSSProperties
                      }
                    >
                      {testimonial.avatarImage ? (
                        <Image
                          src={testimonial.avatarImage}
                          alt={testimonial.name}
                          fill
                          sizes="40px"
                          className="object-cover object-top"
                        />
                      ) : (
                        <span aria-hidden>{initials}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-bold">{testimonial.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Scroll testimonials left"
            onClick={() => scrollByDirection(-1)}
            disabled={!canScrollLeft}
            className="testimonial-nav-btn z-20 hidden md:flex absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Scroll testimonials right"
            onClick={() => scrollByDirection(1)}
            disabled={!canScrollRight}
            className="testimonial-nav-btn z-20 hidden md:flex absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity ${
              canScrollRight ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent transition-opacity ${
              canScrollLeft ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </div>
      {activeTestimonial && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Testimonial from ${activeTestimonial.name}`}
          onClick={() => setActiveId(null)}
          className="testimonial-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-6 py-10 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToOffset(-1);
            }}
            aria-label="Previous testimonial"
            className="testimonial-nav-btn z-[60] hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToOffset(1);
            }}
            aria-label="Next testimonial"
            className="testimonial-nav-btn z-[60] hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <article
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => {
              touchStartXRef.current = e.touches[0].clientX;
              touchDeltaXRef.current = 0;
            }}
            onTouchMove={(e) => {
              if (touchStartXRef.current === null) return;
              touchDeltaXRef.current = e.touches[0].clientX - touchStartXRef.current;
            }}
            onTouchEnd={() => {
              const dx = touchDeltaXRef.current;
              touchStartXRef.current = null;
              touchDeltaXRef.current = 0;
              if (Math.abs(dx) < 40) return;
              goToOffset(dx < 0 ? 1 : -1);
            }}
            className="testimonial-modal-card relative max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.35)]"
          >
            <button
              type="button"
              onClick={() => setActiveId(null)}
              aria-label="Close testimonial"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div className="mb-1 text-3xl font-black leading-none text-foreground/15 select-none">&ldquo;</div>
            <div className="mb-6 pr-6 text-foreground/90">
              <TestimonialContent content={activeTestimonial.content} />
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const [tintLight, tintDark] = pickMonogramTint(activeTestimonial.name);
                const initials = activeTestimonial.avatar || deriveInitials(activeTestimonial.name);
                return (
                  <div
                    className="testimonial-monogram relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-sm font-semibold"
                    style={
                      {
                        "--monogram-bg-light": tintLight,
                        "--monogram-bg-dark": tintDark,
                      } as React.CSSProperties
                    }
                  >
                    {activeTestimonial.avatarImage ? (
                      <Image
                        src={activeTestimonial.avatarImage}
                        alt={activeTestimonial.name}
                        fill
                        sizes="40px"
                        className="object-cover object-top"
                      />
                    ) : (
                      <span aria-hidden>{initials}</span>
                    )}
                  </div>
                );
              })()}
              <div className="min-w-0">
                <p className="truncate font-bold">{activeTestimonial.name}</p>
                <p className="truncate text-sm text-muted-foreground">{activeTestimonial.role}</p>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

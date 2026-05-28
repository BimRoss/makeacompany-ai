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

export function TestimonialsCarousel({ testimonials }: { testimonials: LanderTestimonial[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const activeTestimonial = activeId ? testimonials.find((t) => t.id === activeId) ?? null : null;

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
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [activeId]);

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

        <div className="relative mx-4">
          <div
            ref={scrollRef}
            className="-mx-2 flex gap-4 overflow-x-auto overscroll-x-contain px-2 py-6 snap-x snap-mandatory scroll-smooth"
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
                  <p className="mb-6 line-clamp-4 text-pretty text-foreground/90">
                    &ldquo;{testimonial.content}&rdquo;
                  </p>
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
                      <p className="truncate font-semibold">{testimonial.name}</p>
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
          <article
            onClick={(e) => e.stopPropagation()}
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
            <p className="mb-6 text-pretty pr-6 text-foreground/90">
              &ldquo;{activeTestimonial.content}&rdquo;
            </p>
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
                <p className="truncate font-semibold">{activeTestimonial.name}</p>
                <p className="truncate text-sm text-muted-foreground">{activeTestimonial.role}</p>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

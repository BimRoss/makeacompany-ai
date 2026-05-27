"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { LanderTestimonial } from "@/lib/lander-testimonials";

type CarouselPhase = "idle" | "dragging";

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
  const [phase, setPhase] = useState<CarouselPhase>("idle");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Set when a mousedown turns into a real drag, so the subsequent click on
  // the same card doesn't open the modal.
  const draggedRef = useRef(false);
  const activeTestimonial = activeId ? testimonials.find((t) => t.id === activeId) ?? null : null;

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

  const openModal = (id: string) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setActiveId(id);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;

    const startX = e.pageX;
    const startScroll = el.scrollLeft;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.pageX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        setPhase("dragging");
      }
      if (moved) {
        el.scrollLeft = startScroll - dx;
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) {
        draggedRef.current = true;
        setPhase("idle");
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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

        <div className="relative">
        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          className={`-mx-2 flex gap-4 overflow-x-auto overscroll-x-contain px-2 py-2 snap-x snap-mandatory ${
            phase === "dragging" ? "cursor-grabbing select-none snap-none" : "md:cursor-grab"
          }`}
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
                tabIndex={0}
                role="button"
                aria-label={`Read full testimonial from ${testimonial.name}`}
                onClick={() => openModal(testimonial.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openModal(testimonial.id);
                  }
                }}
                className="testimonial-card group/card flex shrink-0 snap-start w-[85%] max-w-[360px] sm:w-[340px] lg:w-[360px] cursor-pointer flex-col rounded-xl border border-border bg-card/60 p-6 transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
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
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
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

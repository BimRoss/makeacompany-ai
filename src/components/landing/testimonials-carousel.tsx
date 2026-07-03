"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// A single testimonial card. Used twice per row (real + duplicate) to make the
// marquee loop seamlessly; the duplicate is aria-hidden so screen readers and
// tab order only see each quote once. Deliberately does NOT use the
// `.testimonial-card` reveal class — that one starts at opacity:0 and only shows
// once an IntersectionObserver marks it in-view, which never fires on a row
// that's always moving.
function TestimonialCard({
  testimonial,
  onOpen,
  ariaHidden,
}: {
  testimonial: LanderTestimonial;
  onOpen: () => void;
  ariaHidden?: boolean;
}) {
  const [tintLight, tintDark] = pickMonogramTint(testimonial.name);
  const initials = testimonial.avatar || deriveInitials(testimonial.name);
  return (
    <article
      {...(ariaHidden
        ? { "aria-hidden": true, tabIndex: -1 }
        : {
            tabIndex: 0,
            role: "button",
            "aria-label": `Read full testimonial from ${testimonial.name}`,
          })}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group/card flex shrink-0 mr-4 w-[300px] sm:w-[340px] min-h-[280px] cursor-pointer flex-col rounded-xl border border-border bg-card/60 p-6 transition hover:border-foreground/30 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
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
}

// Named testimonials lead the carousel; the generic "Early user" / "Anonymous"
// ones sort to the back (John's call). Stable so relative order is otherwise
// preserved.
function isGenericName(name: string): boolean {
  return /^(early users?|anonymous)$/i.test(name.trim());
}

export function TestimonialsCarousel({ testimonials }: { testimonials: LanderTestimonial[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const ordered = useMemo(
    () =>
      [...testimonials].sort(
        (a, b) => Number(isGenericName(a.name)) - Number(isGenericName(b.name)),
      ),
    [testimonials],
  );
  const activeIndex = activeId ? ordered.findIndex((t) => t.id === activeId) : -1;
  const activeTestimonial = activeIndex >= 0 ? ordered[activeIndex] : null;
  const goToOffset = useCallback(
    (offset: number) => {
      if (activeIndex < 0) return;
      const next = (activeIndex + offset + ordered.length) % ordered.length;
      setActiveId(ordered[next].id);
    },
    [activeIndex, ordered],
  );
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef(0);

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

  if (testimonials.length === 0) return null;

  return (
    <section id="testimonials" className="bg-muted/30 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Early members are already seeing results
          </h2>
          <p className="text-lg text-muted-foreground">
            Here&apos;s what beta testers are saying about makeacompany.ai
          </p>
        </div>
      </div>

      {/* Auto-sliding marquee: the track translates right-to-left very slowly and
          loops seamlessly (two identical copies, shifted -50%). Hover pauses it,
          reduced-motion stops it, and every card stays clickable to open the full
          quote. Edge fade masks keep cards from popping in at the borders. */}
      <div
        className="testimonials-marquee relative overflow-hidden py-6"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        }}
      >
        <div className="testimonials-marquee-track flex w-max px-4">
          {ordered.map((t) => (
            <TestimonialCard
              key={t.id}
              testimonial={t}
              onOpen={() => setActiveId(t.id)}
            />
          ))}
          {ordered.map((t) => (
            <TestimonialCard
              key={`${t.id}-dup`}
              testimonial={t}
              onOpen={() => setActiveId(t.id)}
              ariaHidden
            />
          ))}
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
            key={activeTestimonial.id}
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
            <div className="mb-6 pr-8 text-foreground/90">
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

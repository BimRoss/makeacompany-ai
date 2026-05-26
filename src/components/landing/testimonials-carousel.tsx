"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { LanderTestimonial } from "@/lib/lander-testimonials";

const MD_MIN = 768;

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

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (typeof window !== "undefined" && window.innerWidth < MD_MIN) return;
    const el = scrollRef.current;
    if (!el) return;

    const startX = e.pageX;
    const startScroll = el.scrollLeft;

    setPhase("dragging");

    const onMove = (ev: MouseEvent) => {
      el.scrollLeft = startScroll - (ev.pageX - startX);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Desktop: leave scroll position where the drag ended (no snap).
      // Mobile uses touch + CSS scroll-snap only; this handler does not run there.
      setPhase("idle");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
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
          className={`-mx-2 flex gap-4 overflow-x-auto overscroll-x-contain px-2 py-2 md:py-5 ${
            phase === "dragging"
              ? "snap-none md:cursor-grabbing md:select-none"
              : "max-md:snap-x max-md:snap-mandatory md:snap-none md:cursor-grab"
          }`}
          style={{ touchAction: "pan-x" }}
          role="region"
          aria-label="Testimonials"
        >
          {testimonials.map((testimonial) => {
            const [tintLight, tintDark] = pickMonogramTint(testimonial.name);
            return (
            <article
              key={testimonial.id}
              className={`testimonial-card flex min-w-[84%] flex-col snap-start rounded-xl border border-border bg-card/60 p-6 md:hover:border-foreground/25 md:hover:bg-card md:hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)] dark:md:hover:shadow-[0_14px_44px_-12px_rgba(255,255,255,0.08)] sm:min-w-[48%] lg:min-w-[31%] ${phase === "dragging" ? "md:cursor-grabbing" : "md:cursor-pointer"}`}
            >
              <p
                className="mb-6 line-clamp-4 text-pretty text-foreground/90"
                title={testimonial.content}
              >
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
                    <span aria-hidden>{testimonial.avatar || deriveInitials(testimonial.name)}</span>
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
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent md:hidden"
        />
        </div>
      </div>
    </section>
  );
}

"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { LanderTestimonial } from "@/lib/lander-testimonials";

const MD_MIN = 768;

type CarouselPhase = "idle" | "dragging";

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
          {testimonials.map((testimonial) => (
            <article
              key={testimonial.id}
              className={`testimonial-card min-w-[84%] snap-start rounded-xl border border-border bg-card/60 p-6 md:hover:border-foreground/25 md:hover:bg-card md:hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)] dark:md:hover:shadow-[0_14px_44px_-12px_rgba(255,255,255,0.08)] sm:min-w-[48%] lg:min-w-[31%] ${phase === "dragging" ? "md:cursor-grabbing" : "md:cursor-pointer"}`}
            >
              <p className="mb-6 text-pretty text-foreground/90">&ldquo;{testimonial.content}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border bg-background text-sm font-semibold">
                  {testimonial.avatarImage ? (
                    <Image
                      src={testimonial.avatarImage}
                      alt={testimonial.name}
                      fill
                      sizes="40px"
                      className="object-cover object-top"
                    />
                  ) : (
                    testimonial.avatar
                  )}
                </div>
                <div>
                  <p className="font-semibold">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </div>
            </article>
          ))}
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

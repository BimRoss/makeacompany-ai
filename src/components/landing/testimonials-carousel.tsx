"use client";

import { Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TESTIMONIALS = [
  {
    id: 1,
    name: "Sarah Chen",
    role: "Founder, TechFlow",
    avatar: "SC",
    content:
      "We replaced 3 part-time VAs with makeacompany.ai. It's like having a team that never sleeps and actually follows instructions.",
  },
  {
    id: 2,
    name: "Marcus Johnson",
    role: "CEO, DataScale",
    avatar: "MJ",
    content:
      "We went from zero to a working support queue in one afternoon—agents handle most tickets; we only step in on edge cases.",
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    role: "Head of Ops, Velocity",
    avatar: "ER",
    content:
      "The ROI is real—we cut what we’d have paid contractors for the same throughput, and quality went up because nothing slips.",
  },
  {
    id: 4,
    name: "David Park",
    role: "Solo Founder",
    avatar: "DP",
    content:
      "As a solo founder, this gave me a team. I finally have someone to delegate to. Game changer for indie hackers.",
  },
  {
    id: 5,
    name: "Alex Thompson",
    role: "VP Engineering, CloudBase",
    avatar: "AT",
    content:
      "Slack-native was non-negotiable for us—the handoff feels like @mentioning a teammate, not opening another tool.",
  },
  {
    id: 6,
    name: "Jennifer Wu",
    role: "COO, GrowthLabs",
    avatar: "JW",
    content:
      "We created specialized agents for sales, support, and ops. Each one has their own personality and expertise.",
  },
];

const MD_MIN = 768;

function nearestSnapScrollLeft(el: HTMLDivElement): number {
  const articles = Array.from(el.querySelectorAll<HTMLElement>("article"));
  if (articles.length === 0) return el.scrollLeft;

  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
  const viewportCenter = el.scrollLeft + el.clientWidth / 2;

  let bestLeft = el.scrollLeft;
  let bestDist = Infinity;

  for (const child of articles) {
    const childCenter = child.offsetLeft + child.offsetWidth / 2;
    const dist = Math.abs(childCenter - viewportCenter);
    if (dist < bestDist) {
      bestDist = dist;
      bestLeft = Math.max(0, Math.min(child.offsetLeft, maxScroll));
    }
  }

  return bestLeft;
}

type CarouselPhase = "idle" | "dragging" | "settling";

export function TestimonialsCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<CarouselPhase>("idle");

  useEffect(() => {
    return () => {
      if (settleFallbackRef.current) clearTimeout(settleFallbackRef.current);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (typeof window !== "undefined" && window.innerWidth < MD_MIN) return;
    const el = scrollRef.current;
    if (!el) return;

    if (settleFallbackRef.current) {
      clearTimeout(settleFallbackRef.current);
      settleFallbackRef.current = null;
    }

    const startX = e.pageX;
    const startScroll = el.scrollLeft;

    setPhase("dragging");

    const onMove = (ev: MouseEvent) => {
      el.scrollLeft = startScroll - (ev.pageX - startX);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      const target = nearestSnapScrollLeft(el);
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const delta = Math.abs(target - el.scrollLeft);

      if (settleFallbackRef.current) {
        clearTimeout(settleFallbackRef.current);
        settleFallbackRef.current = null;
      }

      if (reduceMotion || delta < 2) {
        el.scrollTo({ left: target, behavior: "auto" });
        setPhase("idle");
        return;
      }

      setPhase("settling");
      el.scrollTo({ left: target, behavior: "smooth" });

      let finished = false;
      const finishSettling = () => {
        if (finished) return;
        finished = true;
        if (settleFallbackRef.current) {
          clearTimeout(settleFallbackRef.current);
          settleFallbackRef.current = null;
        }
        // If the user already started a new drag, stay on that phase.
        setPhase((p) => (p === "settling" ? "idle" : p));
      };

      el.addEventListener("scrollend", finishSettling, { once: true });
      settleFallbackRef.current = setTimeout(finishSettling, 600);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

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

        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          className={`-mx-2 flex gap-4 overflow-x-auto overscroll-x-contain px-2 pb-2 ${
            phase === "idle"
              ? "snap-x snap-mandatory md:cursor-grab"
              : phase === "dragging"
                ? "snap-none md:cursor-grabbing md:select-none"
                : "snap-none md:cursor-grab"
          }`}
          role="region"
          aria-label="Testimonials"
        >
          {TESTIMONIALS.map((testimonial) => (
            <article
              key={testimonial.id}
              className={`faq-details min-w-[84%] snap-start rounded-xl border border-border bg-card/60 p-6 md:hover:border-foreground/25 md:hover:bg-card md:hover:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.14)] dark:md:hover:shadow-[0_14px_44px_-12px_rgba(255,255,255,0.08)] sm:min-w-[48%] lg:min-w-[31%] ${phase === "dragging" ? "md:cursor-grabbing" : "md:cursor-pointer"}`}
            >
              <div className="mb-4 flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-foreground text-foreground" />
                ))}
              </div>
              <p className="mb-6 text-pretty text-muted-foreground">&quot;{testimonial.content}&quot;</p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold">
                  {testimonial.avatar}
                </div>
                <div>
                  <p className="font-semibold">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

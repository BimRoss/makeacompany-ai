"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FeaturedProduct } from "@/lib/featured-products";

export function FeaturedProductsCarousel({ products }: { products: FeaturedProduct[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasScrolledRight, setHasScrolledRight] = useState(false);
  const initialScrollLeftRef = useRef<number | null>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (initialScrollLeftRef.current === null) {
      initialScrollLeftRef.current = el.scrollLeft;
    }
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
    if (el.scrollLeft > (initialScrollLeftRef.current ?? 0) + 8) {
      setHasScrolledRight(true);
    }
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
  }, [updateScrollState, products.length]);

  const scrollByDirection = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    if (dir === 1) setHasScrolledRight(true);
    const card = el.querySelector<HTMLElement>("[data-featured-card]");
    const gap = 16;
    const step = (card?.offsetWidth ?? el.clientWidth * 0.8) + gap;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const target = Math.max(0, Math.min(el.scrollLeft + dir * step, maxScroll));
    el.scrollTo({ left: target, behavior: "smooth" });
  };

  if (products.length === 0) return null;

  return (
    <section id="products" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Built on makeacompany.ai
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Real products from real founders
          </h2>
          <p className="text-lg text-muted-foreground">
            Live sites made by the community. Tap any card to see one.
          </p>
        </div>

        <div className="relative mx-2 sm:mx-4 md:mx-14">
          <div
            ref={scrollRef}
            className="-mx-4 flex gap-4 overflow-x-auto overscroll-x-contain px-4 py-12 sm:-mx-2 sm:px-2 md:mx-0 md:px-0 snap-x snap-proximity scroll-smooth [&>a:last-child]:snap-end"
            style={{ touchAction: "pan-x" }}
            role="region"
            aria-label="Featured products built on makeacompany.ai"
          >
            {products.map((product) => (
              <a
                key={product.slug}
                data-featured-card
                href={product.url}
                target="_blank"
                rel="noopener"
                aria-label={`Visit ${product.name}`}
                style={{
                  backgroundColor: product.brand.bg,
                  color: product.brand.fg,
                }}
                className="group/card flex shrink-0 snap-start w-[85%] max-w-[360px] sm:w-[340px] lg:w-[360px] min-h-[360px] flex-col rounded-xl border border-black/5 p-5 sm:p-6 shadow-sm transition-all duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:scale-[1.025] hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
              >
                <p
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: product.brand.accent }}
                >
                  {product.eyebrow}
                </p>
                {product.logo ? (
                  <div className="mb-3 flex items-center">
                    <Image
                      src={product.logo.src}
                      alt={`${product.name} logo`}
                      width={product.logo.width}
                      height={product.logo.height}
                      className="h-7 sm:h-8 w-auto"
                      priority={false}
                    />
                  </div>
                ) : (
                  <h3 className="mb-3 text-xl sm:text-2xl font-bold leading-tight tracking-tight whitespace-nowrap">
                    {product.name}
                  </h3>
                )}
                <p className="mb-4 text-[15px] sm:text-base font-semibold leading-snug">
                  {product.tagline}
                </p>
                <p
                  className="mb-6 text-sm leading-relaxed"
                  style={{ color: product.brand.mutedFg }}
                >
                  {product.description}
                </p>
                <div className="mt-auto flex flex-col gap-2">
                  <span
                    style={{
                      backgroundColor: product.brand.accent,
                      color: product.brand.accentFg,
                    }}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all duration-300 ease-out group-hover/card:gap-2.5"
                  >
                    {product.cta}
                    <span aria-hidden>→</span>
                  </span>
                  <span
                    className="truncate text-xs"
                    style={{ color: product.brand.mutedFg }}
                  >
                    {new URL(product.url).host}
                  </span>
                </div>
              </a>
            ))}
          </div>

          <button
            type="button"
            aria-label="Scroll featured products left"
            onClick={() => scrollByDirection(-1)}
            disabled={!canScrollLeft || !hasScrolledRight}
            className="z-20 hidden md:flex absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Scroll featured products right"
            onClick={() => scrollByDirection(1)}
            disabled={!canScrollRight}
            className="z-20 hidden md:flex absolute right-0 top-1/2 translate-x-full -translate-y-1/2 h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/30 bg-background text-foreground shadow-xl ring-1 ring-black/5 transition hover:scale-105 hover:border-foreground hover:bg-foreground hover:text-background disabled:pointer-events-none disabled:opacity-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

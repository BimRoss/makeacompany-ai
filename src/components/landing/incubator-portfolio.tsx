import Image from "next/image";

import type { FeaturedProduct } from "@/lib/featured-products";

/**
 * Portfolio section for the incubator lander. Reuses the per-product brand
 * palette from featured-products so each card carries the company's own colors.
 * Brandlete is the flagship (rendered first, flagged); Nexus sits alongside.
 * Order is driven by the `products` array the page passes in.
 */
export function IncubatorPortfolio({
  products,
}: {
  products: FeaturedProduct[];
}) {
  if (products.length === 0) return null;

  return (
    <section id="portfolio" className="py-10 sm:py-14">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-10 text-center sm:mb-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Portfolio
          </p>
          <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Companies we build alongside.
          </h2>
          <p className="mx-auto max-w-xl text-pretty text-lg text-muted-foreground">
            Real companies we build alongside, with the same team that would back
            yours.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {products.map((product, index) => (
            <a
              key={product.slug}
              href={product.url}
              target="_blank"
              rel="noopener"
              aria-label={`Visit ${product.name}`}
              style={{
                backgroundColor: product.brand.bg,
                color: product.brand.fg,
              }}
              className="group/card flex min-h-[320px] flex-col rounded-2xl border border-black/5 p-6 shadow-sm transition-all duration-300 ease-out will-change-transform hover:-translate-y-1.5 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 sm:p-8"
            >
              <div className="mb-3 flex items-center gap-2">
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: product.brand.accent }}
                >
                  {product.eyebrow}
                </p>
                {index === 0 && (
                  <span
                    style={{
                      backgroundColor: product.brand.accent,
                      color: product.brand.accentFg,
                    }}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                  >
                    Flagship
                  </span>
                )}
              </div>

              {product.logo ? (
                <div className="mb-4 flex items-center">
                  <Image
                    src={product.logo.src}
                    alt={`${product.name} logo`}
                    width={product.logo.width}
                    height={product.logo.height}
                    className="h-8 w-auto"
                    priority={false}
                  />
                </div>
              ) : (
                <h3 className="mb-4 text-2xl font-bold leading-tight tracking-tight">
                  {product.name}
                </h3>
              )}

              <p className="mb-4 text-base font-semibold leading-snug sm:text-lg">
                {product.tagline}
              </p>
              <p
                className="mb-6 text-sm leading-relaxed"
                style={{ color: product.brand.mutedFg }}
              >
                {product.description}
              </p>

              <div className="mt-auto flex items-center gap-2">
                <span
                  style={{
                    backgroundColor: product.brand.accent,
                    color: product.brand.accentFg,
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ease-out group-hover/card:gap-2.5"
                >
                  {product.cta}
                  <span aria-hidden>→</span>
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

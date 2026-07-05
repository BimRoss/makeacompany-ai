import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { IncubatorPortfolio } from "@/components/landing/incubator-portfolio";
import { PreviewCta } from "@/components/landing/preview-cta";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";
import { PreviewProduct } from "@/components/landing/preview-product";
import { PreviewValue } from "@/components/landing/preview-value";
import { SideNav, SideNavProvider } from "@/components/landing/side-nav";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { getFeaturedProducts } from "@/lib/featured-products";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import { MORE_SECTIONS } from "@/lib/more-sections";

// The "companies/concepts we're building alongside" strip on the homepage
// (John, 2026-07-05). Reuses the incubator portfolio cards + copy so the two
// surfaces stay in sync. Excludes the MaC platform card itself — this is the
// things-we-build-with-it list. Order: flagship first, then the newer builds.
const PORTFOLIO_SLUGS = [
  "brandlete",
  "nexus-ats",
  "worldcup",
  "dating-venue",
] as const;

// Nav tray for the minimal homepage: items open the fuller sections on /more
// (which the homepage otherwise keeps off). The page body below stays exactly
// as-is; the tray is the only addition, surfaced via the header hamburger.
const EXPLORE_NAV = MORE_SECTIONS.map((s) => ({
  href: `/more#${s.id}`,
  label: s.label,
}));

/**
 * Minimal, boardy-style preview lander served at `preview.makeacompany.ai`
 * (noindex). Hero + logo network + short product explainer + value row +
 * closing CTA + footer — boardy-clean but with enough substance to orient a
 * first-time visitor. The live homepage (the full incubator lander) is
 * untouched.
 */
export async function PreviewLanding() {
  const testimonials = await fetchLanderTestimonials();
  const catalog = getFeaturedProducts();
  const portfolio = PORTFOLIO_SLUGS.map((slug) =>
    catalog.find((p) => p.slug === slug),
  ).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <SideNavProvider>
      <main className="flex min-h-screen flex-col bg-[#f5f4ef] text-foreground dark:bg-black">
        <SideNav anchors={EXPLORE_NAV} />
        <Header />
        <PreviewHero />
        <PreviewNetwork />
        <PreviewProduct />
        <PreviewValue />
        <IncubatorPortfolio products={portfolio} />
        <TestimonialsCarousel testimonials={testimonials} />
        <PreviewCta />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

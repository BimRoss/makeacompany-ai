import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PreviewCta } from "@/components/landing/preview-cta";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";
import { PreviewProduct } from "@/components/landing/preview-product";
import { PreviewValue } from "@/components/landing/preview-value";
import { SideNav, SideNavProvider } from "@/components/landing/side-nav";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import { MORE_SECTIONS } from "@/lib/more-sections";

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

  return (
    <SideNavProvider>
      <main className="flex min-h-screen flex-col bg-[#f5f4ef] text-foreground dark:bg-black">
        <SideNav anchors={EXPLORE_NAV} />
        <Header />
        <PreviewHero />
        <PreviewNetwork />
        <PreviewProduct />
        <PreviewValue />
        <TestimonialsCarousel testimonials={testimonials} />
        <PreviewCta />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PreviewCta } from "@/components/landing/preview-cta";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";
import { PreviewProduct } from "@/components/landing/preview-product";
import { PreviewValue } from "@/components/landing/preview-value";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";

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
    <main className="flex min-h-screen flex-col bg-[#f5f4ef] text-foreground dark:bg-black">
      <Header />
      <PreviewHero />
      <PreviewNetwork />
      <PreviewProduct />
      <PreviewValue />
      <TestimonialsCarousel testimonials={testimonials} />
      <PreviewCta />
      <Footer />
    </main>
  );
}

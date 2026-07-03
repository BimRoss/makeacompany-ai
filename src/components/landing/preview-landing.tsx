import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PreviewCta } from "@/components/landing/preview-cta";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";
import { PreviewProduct } from "@/components/landing/preview-product";
import { PreviewValue } from "@/components/landing/preview-value";

/**
 * Minimal, boardy-style preview lander served at `preview.makeacompany.ai`
 * (noindex). Hero + logo network + short product explainer + value row +
 * closing CTA + footer — boardy-clean but with enough substance to orient a
 * first-time visitor. The live homepage (the full incubator lander) is
 * untouched.
 */
export function PreviewLanding() {
  return (
    <main className="flex min-h-screen flex-col bg-[#f5f4ef] text-foreground dark:bg-black">
      <Header />
      <PreviewHero />
      <PreviewNetwork />
      <PreviewProduct />
      <PreviewValue />
      <PreviewCta />
      <Footer />
    </main>
  );
}

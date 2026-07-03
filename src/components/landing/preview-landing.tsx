import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PreviewCta } from "@/components/landing/preview-cta";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";
import { PreviewValue } from "@/components/landing/preview-value";

/**
 * Minimal, boardy-style preview lander served at `preview.makeacompany.ai`
 * (noindex). Hero + logo network + a short value row + closing CTA + footer —
 * boardy-clean but with enough substance that it doesn't read as too thin. The
 * live homepage (the full incubator lander) is untouched.
 */
export function PreviewLanding() {
  return (
    <main className="flex min-h-screen flex-col bg-[#f5f4ef] text-foreground dark:bg-black">
      <Header />
      <PreviewHero />
      <PreviewNetwork />
      <PreviewValue />
      <PreviewCta />
      <Footer />
    </main>
  );
}

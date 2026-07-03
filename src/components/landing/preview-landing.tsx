import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PreviewHero } from "@/components/landing/preview-hero";
import { PreviewNetwork } from "@/components/landing/preview-network";

/**
 * Minimal, boardy-style preview lander served at `preview.makeacompany.ai`
 * (noindex). Deliberately stripped to hero + network proof + footer — a
 * design sandbox for the "less copy, less motion" direction. The live homepage
 * (the full incubator lander) is untouched.
 */
export function PreviewLanding() {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />
      <PreviewHero />
      <PreviewNetwork />
      <Footer />
    </main>
  );
}

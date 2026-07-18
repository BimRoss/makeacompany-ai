import type { Metadata } from "next";
import { BuiltFromInside } from "@/components/landing/built-from-inside";
import { HarnessVsAgent } from "@/components/landing/harness-vs-agent";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { ComingSoonToast } from "@/components/landing/coming-soon-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { PersonaProvider } from "@/components/landing/persona-context";
import { PricingTiers } from "@/components/landing/pricing-tiers";
import { SideNav, SideNavProvider } from "@/components/landing/side-nav";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { ValueStack } from "@/components/landing/value-stack";
import { FeaturedProductsCarousel } from "@/components/landing/featured-products-carousel";
import { PersonalAgentsRow } from "@/components/landing/personal-agents-row";
import { getFeaturedProducts } from "@/lib/featured-products";
import { fetchLanderMessagesSent } from "@/lib/lander-messages-sent";
import { fetchLanderPersonalAgents } from "@/lib/lander-personal-agents";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import { DEFAULT_PERSONA, parsePersonaParam } from "@/lib/personas";
import { siteDescription, siteTitle } from "@/lib/site";

// Re-fetch the seat count on each request so the pill keeps up with onboarding.
export const dynamic = "force-dynamic";

// The original $99 self-serve lander, preserved here after the incubator became
// the public homepage (2026-07-01). Kept reachable as a backup and for direct
// links; noindex so it doesn't compete with the apex in search. To roll back to
// the $99 homepage, restore this file's body into `src/app/page.tsx`.
export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  robots: { index: false, follow: false },
  alternates: { canonical: "/classic" },
};

export default async function ClassicHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const urlPersona = parsePersonaParam(params.p);
  const [testimonials, initialMessagesSent, initialPersonalAgents] = await Promise.all([
    fetchLanderTestimonials(),
    fetchLanderMessagesSent(),
    fetchLanderPersonalAgents(),
  ]);
  const faqJsonLd = faqStructuredData();

  return (
    <SideNavProvider>
      <main className="flex min-h-screen flex-col bg-background">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <CheckoutReturnToast />
        <ComingSoonToast />
        <SideNav />
        <Header />
        <PersonaProvider
          initialPersona={urlPersona ?? DEFAULT_PERSONA}
          initialFromUrl={urlPersona !== null}
          initialSelected={urlPersona !== null}
        >
          <HeroSection />
          <PersonalAgentsRow initial={initialPersonalAgents} />
          <FeaturedProductsCarousel
            products={getFeaturedProducts()}
            messagesTotal={initialMessagesSent.total}
          />
          <ValueStack />
          <HarnessVsAgent />
          <BuiltFromInside />
          <PricingTiers />
          <TestimonialsCarousel testimonials={testimonials} />
          <CtaSection />
        </PersonaProvider>
        <SeoFaqSection viewAllHref="/faq" askCardsPosition="bottom" />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

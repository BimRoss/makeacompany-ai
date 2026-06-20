import type { Metadata } from "next";
import { BuiltFromInside } from "@/components/landing/built-from-inside";
import { HarnessVsAgent } from "@/components/landing/harness-vs-agent";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { PersonaProvider } from "@/components/landing/persona-context";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { ValueStack } from "@/components/landing/value-stack";
import { FeaturedProductsCarousel } from "@/components/landing/featured-products-carousel";
import { getFeaturedProducts } from "@/lib/featured-products";
import { fetchLanderSlackSeats } from "@/lib/lander-slack-seats";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import { DEFAULT_PERSONA, PERSONA_SLUGS, parsePersonaParam } from "@/lib/personas";
import { siteDescription, siteTitle, siteUrl } from "@/lib/site";

// Re-fetch the seat count on each request so the pill keeps up with onboarding.
export const dynamic = "force-dynamic";

const BASE_METADATA: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: "/" },
  keywords: [
    "AI company",
    "Make a Company $99/mo",
    "AI employees",
    "Slack agents",
    "company automation",
    "solo founder leverage",
    "MakeaCompany",
  ],
};

// Crawlers that honor query strings (Slack, some custom unfurlers) get a
// persona-specific unfurl card when the URL is `/?p=engineer` etc. Crawlers
// that strip the query — LinkedIn/Twitter — fall back to the layout-level OG.
// Operators sharing persona-flavored links should prefer `/for/<slug>` for the
// most reliable persona unfurl.
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = (await searchParams) ?? {};
  const urlPersona = parsePersonaParam(params.p);
  if (!urlPersona) return BASE_METADATA;
  const slug = PERSONA_SLUGS[urlPersona];
  const ogUrl = `${siteUrl}/for/${slug}/opengraph-image`;
  return {
    ...BASE_METADATA,
    openGraph: { images: [ogUrl] },
    twitter: { card: "summary_large_image", images: [ogUrl] },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const urlPersona = parsePersonaParam(params.p);
  const [initialSeats, testimonials] = await Promise.all([
    fetchLanderSlackSeats(),
    fetchLanderTestimonials(),
  ]);
  const faqJsonLd = faqStructuredData(initialSeats);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <CheckoutReturnToast />
      <Header />
      <PersonaProvider
        initialPersona={urlPersona ?? DEFAULT_PERSONA}
        initialFromUrl={urlPersona !== null}
        initialSelected={urlPersona !== null}
      >
        <HeroSection />
        <FeaturedProductsCarousel products={getFeaturedProducts()} />
        <ValueStack />
        <HarnessVsAgent />
        <BuiltFromInside />
        <TestimonialsCarousel testimonials={testimonials} />
        <CtaSection />
      </PersonaProvider>
      <SeoFaqSection seats={initialSeats} viewAllHref="/faq" askCardsPosition="bottom" />
      <Footer />
    </main>
  );
}

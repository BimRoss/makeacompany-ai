import type { Metadata } from "next";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { PersonaProvider } from "@/components/landing/persona-context";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { ValueStack } from "@/components/landing/value-stack";
import { fetchLanderSlackSeats } from "@/lib/lander-slack-seats";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import { DEFAULT_PERSONA, parsePersonaParam } from "@/lib/personas";
import { siteDescription, siteTagline, siteTitle, siteUrl } from "@/lib/site";

// Re-fetch the seat count on each request so the pill keeps up with onboarding.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "AI company",
    "Make a Company $99/mo",
    "AI employees",
    "Slack agents",
    "company automation",
    "solo founder leverage",
    "BimRoss",
  ],
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${siteTagline} — ${siteDescription}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/twitter-image"],
  },
};

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
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <CheckoutReturnToast />
      <Header />
      <PersonaProvider
        initialPersona={urlPersona ?? DEFAULT_PERSONA}
        initialFromUrl={urlPersona !== null}
      >
        <HeroSection initialSeats={initialSeats} />
        <ValueStack />
        <TestimonialsCarousel testimonials={testimonials} />
        <CtaSection />
      </PersonaProvider>
      <SeoFaqSection seats={initialSeats} />
      <Footer />
    </main>
  );
}

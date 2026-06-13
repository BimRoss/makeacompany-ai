import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuiltFromInside } from "@/components/landing/built-from-inside";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { HarnessVsAgent } from "@/components/landing/harness-vs-agent";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { PersonaProvider } from "@/components/landing/persona-context";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { ValueStack } from "@/components/landing/value-stack";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";
import { fetchLanderSlackSeats } from "@/lib/lander-slack-seats";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";
import {
  PERSONA_BY_SLUG,
  PERSONA_LABELS,
  PERSONA_META,
  PERSONA_SLUGS,
  type Persona,
} from "@/lib/personas";
import { siteUrl } from "@/lib/site";

const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export const dynamic = "force-dynamic";

type RouteParams = { persona: string };

export function generateStaticParams(): RouteParams[] {
  return Object.values(PERSONA_SLUGS).map((slug) => ({ persona: slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { persona: slug } = await params;
  const persona: Persona | undefined = PERSONA_BY_SLUG[slug];
  if (!persona) return {};
  const meta = PERSONA_META[persona];
  const url = `${siteUrl}/for/${slug}`;
  const ogImageUrl = `${siteUrl}/for/${slug}/opengraph-image`;
  const twImageUrl = `${siteUrl}/for/${slug}/twitter-image`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/for/${slug}` },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url,
      images: [{ url: ogImageUrl, alt: meta.ogAlt, ...OG_IMAGE_SIZE }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [{ url: twImageUrl, alt: meta.ogAlt, ...OG_IMAGE_SIZE }],
    },
  };
}

export default async function PersonaLandingPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { persona: slug } = await params;
  const persona: Persona | undefined = PERSONA_BY_SLUG[slug];
  if (!persona) notFound();

  const faqJsonLd = faqStructuredData();
  const breadcrumbJsonLd = breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: `For ${PERSONA_LABELS[persona]}`, path: `/for/${slug}` },
  ]);
  const [initialSeats, testimonials] = await Promise.all([
    fetchLanderSlackSeats(),
    fetchLanderTestimonials(),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <CheckoutReturnToast />
      <Header />
      <PersonaProvider initialPersona={persona} initialFromUrl>
        <HeroSection />
        <ValueStack />
        <HarnessVsAgent />
        <BuiltFromInside />
        <TestimonialsCarousel testimonials={testimonials} />
        <CtaSection />
      </PersonaProvider>
      <SeoFaqSection askCardsPosition="bottom" viewAllHref="/faq" />
      <Footer />
    </main>
  );
}

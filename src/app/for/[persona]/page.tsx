import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
import {
  PERSONA_BY_SLUG,
  PERSONA_META,
  PERSONA_SLUGS,
  type Persona,
} from "@/lib/personas";
import { siteUrl } from "@/lib/site";

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
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/for/${slug}` },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: meta.ogAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: ["/twitter-image"],
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
  const [initialSeats, testimonials] = await Promise.all([
    fetchLanderSlackSeats(),
    fetchLanderTestimonials(),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <CheckoutReturnToast />
      <Header />
      <PersonaProvider initialPersona={persona} initialFromUrl>
        <HeroSection initialSeats={initialSeats} />
        <ValueStack />
        <TestimonialsCarousel testimonials={testimonials} />
        <CtaSection />
      </PersonaProvider>
      <SeoFaqSection />
      <Footer />
    </main>
  );
}

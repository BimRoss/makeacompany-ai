import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { HeroRoadmap } from "@/components/landing/hero-roadmap";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { siteDescription, siteTagline, siteTitle, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "AI company",
    "Make a Company $9/mo",
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

export default function HomePage() {
  const faqJsonLd = faqStructuredData();

  return (
    <main className="min-h-screen bg-background">
      <Script id="faq-structured-data" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqJsonLd)}
      </Script>
      <CheckoutReturnToast />
      <Header />
      <HeroSection />
      <TestimonialsCarousel />
      <CtaSection />
      <section className="hidden sm:block">
        <div className="mx-auto w-full max-w-4xl px-6">
          <HeroRoadmap />
        </div>
      </section>
      <SeoFaqSection />
      <section className="pb-8 pt-3">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-3 px-6">
          <Link
            href="/employees"
            className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-7 text-base font-medium text-foreground motion-colors hover:bg-muted"
          >
            Meet Your Employees
          </Link>
          <Link
            href="/skills"
            className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-7 text-base font-medium text-foreground motion-colors hover:bg-muted"
          >
            See Their Skills
          </Link>
        </div>
      </section>
      <Footer />
    </main>
  );
}

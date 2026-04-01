import type { Metadata } from "next";
import Script from "next/script";
import { CountdownTimer } from "@/components/landing/countdown-timer";
import { CheckoutReturnToast } from "@/components/landing/checkout-return-toast";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { WaitlistProgress } from "@/components/landing/waitlist-progress";
import { siteDescription, siteTitle, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "AI company",
    "one human infinite agents",
    "AI employees",
    "Slack agents",
    "company automation",
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
        alt: "Make a Company — one human, infinite agents",
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
      <CountdownTimer />
      <WaitlistProgress />
      <CtaSection />
      <SeoFaqSection />
      <Footer />
    </main>
  );
}

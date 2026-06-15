import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { faqStructuredData, SeoFaqSection } from "@/components/landing/seo-faq";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";
import { fetchLanderSlackSeats } from "@/lib/lander-slack-seats";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FAQ: AI employees in your Slack workspace, $99/month",
  description:
    "Common questions about makeacompany.ai: how the AI employees work in your Slack workspace, what's included for $99/month, what tools they touch, and how to start.",
  alternates: {
    canonical: "/faq",
  },
  openGraph: {
    title: "FAQ: AI employees in your Slack workspace, $99/month",
    description:
      "Common questions about makeacompany.ai: how the AI employees work in your Slack workspace, what's included for $99/month, what tools they touch, and how to start.",
    url: `${siteUrl}/faq`,
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ: AI employees in your Slack workspace, $99/month",
    description:
      "Common questions about makeacompany.ai: how the AI employees work in your Slack workspace, what's included for $99/month, what tools they touch, and how to start.",
    images: ["/twitter-image"],
  },
};

export default async function FaqPage() {
  const initialSeats = await fetchLanderSlackSeats();
  const faqJsonLd = faqStructuredData(initialSeats);
  const breadcrumbJsonLd = breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "FAQ", path: "/faq" },
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
      <Header />
      <section className="mx-auto w-full max-w-4xl px-6 pt-16 sm:pt-20">
        <h1 className="text-center text-4xl font-semibold tracking-tight sm:text-5xl">
          Frequently asked questions
        </h1>
        <p className="mt-6 text-center text-base text-muted-foreground">
          Everything we get asked most often about running AI employees in your Slack workspace.
        </p>
      </section>
      <SeoFaqSection seats={initialSeats} hideHeading />
      <Footer />
    </main>
  );
}

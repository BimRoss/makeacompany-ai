import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";
import CostPageClient from "./CostPageClient";

export const metadata: Metadata = {
  title: "Cost of an AI agent for your Slack team vs. a $250K hire",
  description:
    "A senior NYC hire costs ~$250K/year fully loaded. An AI agent for your Slack team costs $1,200/year. ~208× more leverage per dollar. Your team doesn't shrink, your output multiplies.",
  alternates: { canonical: "/cost" },
  openGraph: {
    title: "AI agent for your Slack team: $1,200/yr vs a $250K hire",
    description:
      "$250K/yr vs $1,200/yr, the math on a senior hire vs. an AI agent in your Slack.",
    url: "/cost",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI agent for your Slack team: $1,200/yr vs a $250K hire",
    description:
      "$250K/yr vs $1,200/yr, the math on a senior hire vs. an AI agent in your Slack.",
  },
};

export default function CostPage() {
  const breadcrumbJsonLd = breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "Cost", path: "/cost" },
  ]);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <Header />
      <CostPageClient />
      <Footer />
    </main>
  );
}

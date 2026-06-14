import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";
import CostPageClient from "./CostPageClient";

export const metadata: Metadata = {
  title: "The Cost of Your Next Hire vs. MaC",
  description:
    "A senior NYC hire costs ~$250K/year fully loaded. MaC costs $1,200. That's ~208× more leverage per dollar. Your team doesn't shrink — your output multiplies.",
  alternates: { canonical: "/cost" },
  openGraph: {
    title: "Your team doesn't shrink. Your output multiplies.",
    description:
      "$250K/yr vs $1,200/yr — the math on your next senior hire vs. running MaC.",
    url: "/cost",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your team doesn't shrink. Your output multiplies.",
    description:
      "$250K/yr vs $1,200/yr — the math on your next senior hire vs. running MaC.",
  },
};

export default function CostPage() {
  const breadcrumbJsonLd = breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "Cost", path: "/cost" },
  ]);

  return (
    <main className="min-h-screen bg-background">
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

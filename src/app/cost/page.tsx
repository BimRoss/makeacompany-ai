import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import CostPageClient from "./CostPageClient";

export const metadata: Metadata = {
  title: "The Cost of Your Next Hire vs. MaC",
  description:
    "Two senior NYC hires cost ~$543K/year fully loaded. MaC costs $1,188. That's ~457× more leverage per dollar. Your team doesn't shrink — your output multiplies.",
  alternates: { canonical: "/cost" },
  openGraph: {
    title: "Your team doesn't shrink. Your output multiplies.",
    description:
      "$543K vs $1,188 — the math on hiring two senior teammates vs. running MaC.",
    url: "/cost",
    images: ["/cost-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Your team doesn't shrink. Your output multiplies.",
    description:
      "$543K vs $1,188 — the math on hiring two senior teammates vs. running MaC.",
    images: ["/cost-og.png"],
  },
};

export default function CostPage() {
  return (
    <main className="min-h-screen bg-background">
      <Header />
      <CostPageClient />
      <Footer />
    </main>
  );
}

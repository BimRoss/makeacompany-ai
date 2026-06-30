import type { Metadata } from "next";

import { BuiltFromInside } from "@/components/landing/built-from-inside";
import { Footer } from "@/components/landing/footer";
import { HarnessVsAgent } from "@/components/landing/harness-vs-agent";
import { Header } from "@/components/landing/header";
import { IncubatorCta } from "@/components/landing/incubator-cta";
import { IncubatorHarnessMoat } from "@/components/landing/incubator-harness-moat";
import { IncubatorHero } from "@/components/landing/incubator-hero";
import { IncubatorPortfolio } from "@/components/landing/incubator-portfolio";
import { PersonalAgentsRow } from "@/components/landing/personal-agents-row";
import { SideNav, SideNavProvider } from "@/components/landing/side-nav";
import { TestimonialsCarousel } from "@/components/landing/testimonials-carousel";
import { getFeaturedProducts } from "@/lib/featured-products";
import { fetchLanderPersonalAgents } from "@/lib/lander-personal-agents";
import { fetchLanderTestimonials } from "@/lib/lander-testimonials";

// Live data (agent showcase) on each request, same as the public lander.
export const dynamic = "force-dynamic";

// Preview-only surface. Keep it out of search until it's promoted to the
// real homepage. The `incubator.` host also gets an X-Robots-Tag noindex
// header from middleware as a second layer.
export const metadata: Metadata = {
  title: "makeacompany.ai — private incubator",
  description:
    "A private incubator for founders and operators chasing maximum leverage.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/incubator" },
};

// Portfolio order: Brandlete (flagship) first, then Nexus. Driven by slug so
// the rest of the featured-products catalog stays off this page.
const PORTFOLIO_SLUGS = ["brandlete", "nexus-ats"] as const;

const INCUBATOR_NAV = [
  { href: "#start", label: "Top" },
  { href: "#portfolio", label: "Portfolio" },
  { href: "#how", label: "The harness" },
  { href: "#moat", label: "The moat" },
  { href: "#agents", label: "Agents" },
];

export default async function IncubatorPage() {
  const [personalAgents, testimonials] = await Promise.all([
    fetchLanderPersonalAgents(),
    fetchLanderTestimonials(),
  ]);

  const catalog = getFeaturedProducts();
  const portfolio = PORTFOLIO_SLUGS.map((slug) =>
    catalog.find((p) => p.slug === slug),
  ).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <SideNavProvider>
      <main className="flex min-h-screen flex-col bg-background">
        <SideNav anchors={INCUBATOR_NAV} />
        <Header />
        <IncubatorHero />
        <IncubatorPortfolio products={portfolio} />
        <HarnessVsAgent />
        <IncubatorHarnessMoat />
        <BuiltFromInside />
        <div id="agents">
          <PersonalAgentsRow initial={personalAgents} />
        </div>
        <TestimonialsCarousel testimonials={testimonials} />
        <IncubatorCta />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

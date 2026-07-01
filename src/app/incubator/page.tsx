import type { Metadata } from "next";

import { BuiltFromInside } from "@/components/landing/built-from-inside";
import { Footer } from "@/components/landing/footer";
import { HarnessVsAgent } from "@/components/landing/harness-vs-agent";
import { Header } from "@/components/landing/header";
import { IncubatorCta } from "@/components/landing/incubator-cta";
import { IncubatorFaq } from "@/components/landing/incubator-faq";
import { IncubatorFounders } from "@/components/landing/incubator-founders";
import { IncubatorHarnessMoat } from "@/components/landing/incubator-harness-moat";
import { IncubatorHero } from "@/components/landing/incubator-hero";
import { IncubatorImageBand } from "@/components/landing/incubator-image-band";
import { IncubatorLeverage } from "@/components/landing/incubator-leverage";
import { IncubatorPortfolio } from "@/components/landing/incubator-portfolio";
import { IncubatorProblem } from "@/components/landing/incubator-problem";
import { IncubatorProcess } from "@/components/landing/incubator-process";
import { IncubatorTeam } from "@/components/landing/incubator-team";
import { IncubatorWho } from "@/components/landing/incubator-who";
import { IncubatorWhyFounders } from "@/components/landing/incubator-why-founders";
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
const incubatorOgTitle = "makeacompany.ai — private incubator";
const incubatorOgDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost. A private incubator for founders and operators, by introduction only.";

export const metadata: Metadata = {
  title: incubatorOgTitle,
  description:
    "A private incubator for founders and operators chasing maximum leverage.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/incubator" },
  // Override the inherited public-site unfurl (the "$99/mo AI team" card) so
  // shared incubator links preview in the new look. The OG/Twitter images come
  // from the route's opengraph-image.tsx / twitter-image.tsx.
  openGraph: {
    title: incubatorOgTitle,
    description: incubatorOgDescription,
    url: "/incubator",
    siteName: "makeacompany.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: incubatorOgTitle,
    description: incubatorOgDescription,
  },
};

// Portfolio order: Brandlete (flagship) first, then Nexus. Driven by slug so
// the rest of the featured-products catalog stays off this page.
const PORTFOLIO_SLUGS = ["brandlete", "nexus-ats"] as const;

const INCUBATOR_NAV = [
  { href: "#problem", label: "The problem" },
  { href: "#founders", label: "Founders" },
  { href: "#leverage", label: "Leverage" },
  { href: "#portfolio", label: "Portfolio" },
  { href: "#how", label: "The harness" },
  { href: "#faq", label: "FAQ" },
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
        <IncubatorProblem />
        <IncubatorFounders />
        <IncubatorTeam />
        <IncubatorImageBand
          src="/incubator/leverage.jpg"
          alt="One operator directing a vast network of work that fans out and multiplies"
          caption="One operator. The output of a team."
        />
        <IncubatorLeverage />
        <IncubatorWho />
        <IncubatorWhyFounders />
        <IncubatorPortfolio products={portfolio} />
        <IncubatorImageBand
          src="/incubator/harness-engine.jpg"
          alt="A car rendered in white outline with a glowing blue chip at its core and wiring through the chassis"
        />
        <HarnessVsAgent />
        <IncubatorImageBand
          src="/incubator/harness-foundation.jpg"
          alt="Stacked translucent layers forming a foundation with a single glowing blue core on top"
          caption="A rented core, on a foundation we own."
        />
        <IncubatorHarnessMoat />
        <BuiltFromInside />
        <IncubatorProcess />
        <div id="agents">
          <PersonalAgentsRow initial={personalAgents} />
        </div>
        <TestimonialsCarousel testimonials={testimonials} />
        <IncubatorFaq />
        <IncubatorCta />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

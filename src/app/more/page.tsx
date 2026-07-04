import type { Metadata } from "next";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { IncubatorAgentsFor } from "@/components/landing/incubator-agents-for";
import { IncubatorCommunity } from "@/components/landing/incubator-community";
import { IncubatorCta } from "@/components/landing/incubator-cta";
import { IncubatorFaq } from "@/components/landing/incubator-faq";
import { IncubatorFounders } from "@/components/landing/incubator-founders";
import { IncubatorImageBand } from "@/components/landing/incubator-image-band";
import { IncubatorLeverage } from "@/components/landing/incubator-leverage";
import { IncubatorPortfolio } from "@/components/landing/incubator-portfolio";
import { IncubatorProblem } from "@/components/landing/incubator-problem";
import { IncubatorProcess } from "@/components/landing/incubator-process";
import { IncubatorTeam } from "@/components/landing/incubator-team";
import { IncubatorWho } from "@/components/landing/incubator-who";
import { IncubatorWhyFounders } from "@/components/landing/incubator-why-founders";
import { SideNav, SideNavProvider } from "@/components/landing/side-nav";
import { getFeaturedProducts } from "@/lib/featured-products";
import { MORE_SECTIONS } from "@/lib/more-sections";

// The "explore" companion to the minimal homepage: the fuller MaC story pulled
// from /fullmac, minus the proprietary harness sections (see more-sections.ts).
// Reached only via the homepage nav tray; noindex so the apex stays the SEO
// surface and this doesn't compete with /fullmac.
export const metadata: Metadata = {
  title: "makeacompany.ai — Explore MaC",
  description:
    "The fuller MaC story: leverage, who it's for, the portfolio, the process, the team, and FAQ.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/more" },
};

const PORTFOLIO_SLUGS = ["brandlete", "nexus-ats"] as const;

const NAV = MORE_SECTIONS.map((s) => ({ href: `#${s.id}`, label: s.label }));

export default function MorePage() {
  const catalog = getFeaturedProducts();
  const portfolio = PORTFOLIO_SLUGS.map((slug) =>
    catalog.find((p) => p.slug === slug),
  ).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <SideNavProvider>
      <main className="flex min-h-screen flex-col bg-background">
        <SideNav anchors={NAV} />
        <Header />
        <IncubatorAgentsFor />
        <IncubatorProblem />
        {/* Section graphics restored here (they live on the full lander but were
            dropped when /more was slimmed). Each anchors its matching section. */}
        <IncubatorImageBand
          src="/incubator/leverage.jpg"
          alt="One operator directing a vast network of work that fans out and multiplies"
          caption="One operator. The output of a team."
        />
        <IncubatorLeverage />
        <IncubatorWho />
        <IncubatorWhyFounders />
        <IncubatorCommunity />
        <IncubatorImageBand
          src="/incubator/harness-foundation.jpg"
          alt="Stacked translucent layers forming a foundation with a single glowing blue core on top"
          caption="A foundation we own, not a tool we rent."
        />
        <IncubatorPortfolio products={portfolio} />
        <IncubatorImageBand
          src="/incubator/harness-engine.jpg"
          alt="A car rendered in white outline with a glowing blue chip at its core and wiring through the chassis"
        />
        <IncubatorProcess />
        <IncubatorTeam />
        <IncubatorFounders />
        <IncubatorFaq />
        <IncubatorCta />
        <Footer />
      </main>
    </SideNavProvider>
  );
}

import type { Metadata } from "next";

import { IncubatorLanding } from "@/components/landing/incubator-landing";

// Live data (agent showcase, testimonials) on each request.
export const dynamic = "force-dynamic";

// The builders' incubator is the public homepage (promoted 2026-07-01). Indexed
// and canonical at the apex. The OG/Twitter card comes from the route-level
// opengraph-image.tsx / twitter-image.tsx (the incubator card). The prior $99
// self-serve lander lives on at /classic.
const homeTitle = "makeacompany.ai — the builders' incubator";
const homeDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost. The builders' incubator, for founders and operators chasing maximum leverage.";

export const metadata: Metadata = {
  title: homeTitle,
  description:
    "The builders' incubator, for founders and operators chasing maximum leverage on their money, time, and focus.",
  alternates: { canonical: "/" },
  keywords: [
    "startup incubator",
    "founder incubator",
    "AI agents for founders",
    "builders incubator",
    "operator leverage",
    "MakeaCompany",
  ],
  openGraph: {
    title: homeTitle,
    description: homeDescription,
    url: "/",
    siteName: "makeacompany.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: homeTitle,
    description: homeDescription,
  },
};

export default function HomePage() {
  return <IncubatorLanding />;
}

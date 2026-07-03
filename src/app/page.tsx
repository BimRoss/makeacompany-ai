import type { Metadata } from "next";

import { PreviewLanding } from "@/components/landing/preview-landing";

// Live data (testimonials) on each request.
export const dynamic = "force-dynamic";

// The minimal boardy-style lander is the public homepage (promoted 2026-07-03,
// John's call). Indexed and canonical at the apex. The full builders' incubator
// site is preserved at /fullmac (noindex) and still at /incubator; the prior
// $99 self-serve lander remains at /classic. Rollback = restore IncubatorLanding
// here. The OG/Twitter card is still the incubator card (opengraph-image.tsx);
// swap on request.
const homeTitle = "makeacompany.ai — Multiply yourself";
const homeDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost. A team of agents that runs your company from inside Slack.";

export const metadata: Metadata = {
  title: homeTitle,
  description: homeDescription,
  alternates: { canonical: "/" },
  keywords: [
    "AI agents",
    "AI agents for founders",
    "AI teammate",
    "Slack agents",
    "makeacompany",
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
  return <PreviewLanding />;
}

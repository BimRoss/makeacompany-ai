import type { Metadata } from "next";

import { IncubatorLanding } from "@/components/landing/incubator-landing";

// Live data (agent showcase) on each request, same as the public lander.
export const dynamic = "force-dynamic";

// Preview alias of the homepage. Kept noindex so it doesn't compete with the
// canonical apex `/` (which now serves the same lander, indexed). The
// `incubator.` host also gets an X-Robots-Tag noindex header from middleware.
const incubatorOgTitle = "makeacompany.ai — the builders' incubator";
const incubatorOgDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost. The builders' incubator, for founders and operators.";

export const metadata: Metadata = {
  title: incubatorOgTitle,
  description:
    "The builders' incubator, for founders and operators chasing maximum leverage.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
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

export default function IncubatorPage() {
  return <IncubatorLanding />;
}

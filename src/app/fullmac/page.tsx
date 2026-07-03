import type { Metadata } from "next";

import { IncubatorLanding } from "@/components/landing/incubator-landing";

// Live data (agent showcase, testimonials) on each request, same as the apex.
export const dynamic = "force-dynamic";

// Preserved copy of the current full makeacompany.ai homepage (the builders'
// incubator lander), parked at /fullmac at John's request (2026-07-03) ahead of
// promoting the minimal preview to the live homepage. Renders the same
// IncubatorLanding component as `/`, kept noindex so the two don't compete in
// search. Nothing here is destructive: the live apex is untouched by this file.
const fullmacTitle = "makeacompany.ai — the builders' incubator";
const fullmacDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost. The builders' incubator, for founders and operators.";

export const metadata: Metadata = {
  title: fullmacTitle,
  description:
    "The full makeacompany.ai site: the builders' incubator, for founders and operators chasing maximum leverage.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/fullmac" },
  openGraph: {
    title: fullmacTitle,
    description: fullmacDescription,
    url: "/fullmac",
    siteName: "makeacompany.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: fullmacTitle,
    description: fullmacDescription,
  },
};

export default function FullMacPage() {
  return <IncubatorLanding />;
}

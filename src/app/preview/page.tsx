import type { Metadata } from "next";

import { PreviewLanding } from "@/components/landing/preview-landing";

// Live testimonial data on each request, same as the public lander.
export const dynamic = "force-dynamic";

// Minimal design preview, served at preview.makeacompany.ai (host rewrite in
// middleware) and at /preview directly. Kept noindex so it never competes with
// the canonical apex `/`. The `preview.` host also gets an X-Robots-Tag
// noindex header from middleware as a second layer.
const previewTitle = "makeacompany.ai — the builders' incubator";
const previewDescription =
  "Multiply yourself. Your best work, in a fraction of the time and cost.";

export const metadata: Metadata = {
  title: previewTitle,
  description: previewDescription,
  robots: { index: false, follow: false },
  alternates: { canonical: "/" },
};

export default function PreviewPage() {
  return <PreviewLanding />;
}

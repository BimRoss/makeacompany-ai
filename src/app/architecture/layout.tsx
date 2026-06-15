import type { Metadata } from "next";
import type { ReactNode } from "react";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";

const title = "Architecture — how makeacompany runs";
const description =
  "How makeacompany is built: persistent Claude Code agents, per-channel workspaces, Slack as the UI, GitOps deploys.";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/architecture",
  },
  openGraph: {
    title,
    description,
    url: "/architecture",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/twitter-image"],
  },
};

export default function ArchitectureLayout({ children }: { children: ReactNode }) {
  const breadcrumbJsonLd = breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "Architecture", path: "/architecture" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {children}
    </>
  );
}

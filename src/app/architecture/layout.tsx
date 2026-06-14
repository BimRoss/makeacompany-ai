import type { Metadata } from "next";
import type { ReactNode } from "react";
import { breadcrumbStructuredData } from "@/lib/breadcrumbs";

export const metadata: Metadata = {
  title: "Architecture — how makeacompany runs",
  description:
    "How makeacompany is built: persistent Claude Code agents, per-channel workspaces, Slack as the UI, GitOps deploys.",
  alternates: {
    canonical: "/architecture",
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

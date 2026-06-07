import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";

const title = "How makeacompany is actually built";
const description =
  "The pods, Slack apps, persistent storage, and GitHub wiring behind your AI team. No marketing, just the architecture.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/architecture" },
  openGraph: {
    title,
    description,
    url: `${siteUrl}/architecture`,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function ArchitectureLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

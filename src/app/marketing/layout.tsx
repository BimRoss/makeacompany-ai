import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Marketing — UTM registry",
  description: "Build tagged URLs and log campaigns to the marketing registry",
  alternates: {
    canonical: "/marketing",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}

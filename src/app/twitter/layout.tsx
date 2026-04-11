import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Twitter",
  description: "Twitter operations dashboard for makeacompany.ai",
  alternates: {
    canonical: "/twitter",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function TwitterLayout({ children }: { children: ReactNode }) {
  return children;
}

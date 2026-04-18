import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Orchestrator",
  description: "Redirects to /admin (legacy URL)",
  alternates: {
    canonical: "/admin",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function OrchestratorLayout({ children }: { children: ReactNode }) {
  return children;
}

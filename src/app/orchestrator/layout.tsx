import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Orchestrator",
  description: "Slack orchestrator routing decisions (operator debug)",
  alternates: {
    canonical: "/orchestrator",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function OrchestratorLayout({ children }: { children: ReactNode }) {
  return children;
}

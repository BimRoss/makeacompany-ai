import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Slack orchestrator — makeacompany.ai",
  alternates: { canonical: "/slack-orchestrator" },
};

export default function SlackOrchestratorLayout({ children }: { children: React.ReactNode }) {
  return children;
}

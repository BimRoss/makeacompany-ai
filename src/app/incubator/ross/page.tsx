import type { Metadata } from "next";

import { IncubatorAgentDetail } from "@/components/landing/incubator-agent-detail";

export const metadata: Metadata = {
  title: "Ross — Chief Engineer, Full Stack | makeacompany.ai incubator",
  description: "Ross ships the code, runs the deploys, and builds the sites.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/incubator/ross" },
};

export default function RossPage() {
  return (
    <IncubatorAgentDetail
      name="Ross"
      role="Chief Engineer, Full Stack"
      headshot="/headshots/ross.webp"
      intro="Ross is the builder. He ships your code, runs your deploys, and stands up your sites, all from inside Slack. This very page is his work, written and shipped the same way he would build for you."
      capabilities={[
        {
          title: "Ships code",
          body: "Writes, reviews, and merges. Tag a release and he watches the rollout land, then confirms it back in Slack.",
        },
        {
          title: "Runs the infrastructure",
          body: "Deploys, DNS, GitOps, cluster health. The unglamorous parts that keep a product running while you sleep.",
        },
        {
          title: "Builds sites and tools",
          body: "From a screenshot or a sentence to a live page, in his own pipeline. No handoff, no waiting on a contractor.",
        },
        {
          title: "Clears the queue",
          body: "Issues, pull requests, inboxes, health checks. He works the backlog so your hours go to direction, not cleanup.",
        },
      ]}
    />
  );
}

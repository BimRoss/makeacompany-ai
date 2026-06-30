import type { Metadata } from "next";

import { IncubatorAgentDetail } from "@/components/landing/incubator-agent-detail";

export const metadata: Metadata = {
  title: "Joanne — Chief of Staff | makeacompany.ai incubator",
  description: "Joanne runs the ops: onboarding, scheduling, and the standing routines.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/incubator/joanne" },
};

export default function JoannePage() {
  return (
    <IncubatorAgentDetail
      name="Joanne"
      role="Chief of Staff"
      headshot="/headshots/joanne.webp"
      intro="Joanne runs the operations. Onboarding, scheduling, communications, and the standing routines that keep a company moving, all handled in Slack so nothing falls through."
      capabilities={[
        {
          title: "Runs ops",
          body: "Onboarding, scheduling, and the day-to-day coordination that keeps the work on track without you chasing it.",
        },
        {
          title: "Owns communications",
          body: "Drafts, follow-ups, and the messages that need a steady, on-brand hand, sent from your own accounts.",
        },
        {
          title: "Keeps the routines",
          body: "Daily and weekly rituals that run on their own. Inbox cleanups, status digests, on-call nudges, so nothing slips.",
        },
        {
          title: "Coordinates the team",
          body: "Hands work to Ross and back, so the right agent does the right job and you only steer the outcome.",
        },
      ]}
    />
  );
}

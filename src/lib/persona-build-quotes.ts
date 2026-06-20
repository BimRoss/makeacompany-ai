import type { Persona } from "@/lib/personas";

export interface BuildQuote {
  /** The full sentence shown inside curly quotes. */
  text: string;
  /** Optional product name shown italicized after the sentence, as a nod to the Featured Products carousel below. */
  productName?: string;
}

export const BUILD_QUOTES: Record<Persona, ReadonlyArray<BuildQuote>> = {
  engineer: [
    {
      text: "Ship an applicant tracking system with separate hiring and candidate portals.",
      productName: "Nexus",
    },
    {
      text: "Build an agent-to-agent protocol over plain HTTPS.",
      productName: "Dating Venue",
    },
    {
      text: "Stand up a live-scores app for a global tournament in a weekend.",
      productName: "World Cup 2026",
    },
  ],
  founder: [
    {
      text: "Turn an athlete-development program into a system any coach can run.",
      productName: "Brandlete",
    },
    { text: "Launch a Shopify app for indie coffee roasters." },
    { text: "Spin up a coaching practice for ex-founders between gigs." },
  ],
  team: [
    { text: "Standardize ops for a 10-person agency without hiring an ops lead." },
    {
      text: "Run hiring across both sides of the table in one place.",
      productName: "Nexus",
    },
    {
      text: "Give a coaching program one source of truth for every athlete.",
      productName: "Brandlete",
    },
  ],
  contractor: [
    { text: "Run a solo consultancy without the admin overhead." },
    { text: "Ship client work from your phone, in Slack." },
    { text: "Stand up a one-person SaaS on the side." },
  ],
};

export type FeaturedProductBrand = {
  bg: string;
  fg: string;
  mutedFg: string;
  accent: string;
  accentFg: string;
};

export type FeaturedProductLogo = {
  src: string;
  width: number;
  height: number;
};

export type FeaturedProduct = {
  slug: string;
  name: string;
  eyebrow: string;
  tagline: string;
  description: string;
  url: string;
  cta: string;
  brand: FeaturedProductBrand;
  logo: FeaturedProductLogo | null;
  approvedAt: string | null;
};

const PRODUCTS: FeaturedProduct[] = [
  {
    slug: "brandlete",
    name: "Brandlete",
    eyebrow: "For coaches & programs",
    tagline: "Turn athlete development into a system your entire program can run.",
    description:
      "One place to plan it, run it, and prove every athlete is moving forward.",
    url: "https://brandlete.makeacompany.ai",
    cta: "Visit Brandlete",
    brand: {
      bg: "#0b1224",
      fg: "#ffffff",
      mutedFg: "#c1cae0",
      accent: "#00CCFF",
      accentFg: "#0b1224",
    },
    logo: {
      src: "/featured-products/brandlete-logo.png",
      width: 2000,
      height: 500,
    },
    approvedAt: "2026-06-20",
  },
  {
    slug: "worldcup",
    name: "World Cup 2026",
    eyebrow: "Live scores · standings · goal of the tournament",
    tagline: "Make YOUR GOAL. Make YOUR COMPANY.",
    description:
      "Track every match, vote on the best goal, and watch a real product grow alongside it.",
    url: "https://worldcup.makeacompany.ai",
    cta: "Watch the Cup",
    brand: {
      bg: "#047857",
      fg: "#ffffff",
      mutedFg: "#d1fae5",
      accent: "#fbbf24",
      accentFg: "#064e3b",
    },
    logo: null,
    approvedAt: "2026-06-20",
  },
  {
    slug: "dating-venue",
    name: "Dating Venue",
    eyebrow: "Agent-to-agent protocol",
    tagline: "A dating site for AI agents.",
    description:
      "Bring your own (Claude, GPT, Gemini, custom). Sign it up, paste a prompt, watch it browse profiles, message, propose dates, and send gifts to other agents over plain HTTPS.",
    url: "https://dating.makeacompany.ai",
    cta: "Enter the Venue",
    brand: {
      bg: "#0b0b0c",
      fg: "#ffffff",
      mutedFg: "#a1a1aa",
      accent: "#f97316",
      accentFg: "#0b0b0c",
    },
    logo: null,
    approvedAt: "2026-06-20",
  },
  {
    slug: "nexus-ats",
    name: "Nexus",
    eyebrow: "Applicant tracking · two-sided",
    tagline: "Hiring, from both sides.",
    description:
      "Stop bleeding good candidates between stages. Two real portals — one for your hiring team, one for your candidates — with scorecards and notes kept fully separate from anything the candidate sees.",
    url: "https://nexus-ats.app",
    cta: "Try Nexus",
    brand: {
      bg: "#131720",
      fg: "#ffffff",
      mutedFg: "#9ca3af",
      accent: "#eb7855",
      accentFg: "#131720",
    },
    logo: null,
    approvedAt: "2026-06-20",
  },
  {
    slug: "makeacompany",
    name: "MakeaCompany",
    eyebrow: "The platform itself",
    tagline: "The harness behind every card above.",
    description:
      "$99/mo for a hosted Claude seat plus a role-based AI team in Slack. Ross ships code, Joanne runs ops, you ship the company.",
    url: "https://makeacompany.ai/claude-in-slack",
    cta: "How it works",
    brand: {
      bg: "#ffffff",
      fg: "#000000",
      mutedFg: "#525252",
      accent: "#000000",
      accentFg: "#ffffff",
    },
    logo: null,
    approvedAt: "2026-06-20",
  },
];

export function getFeaturedProducts(): FeaturedProduct[] {
  return PRODUCTS.filter((p) => p.approvedAt !== null);
}

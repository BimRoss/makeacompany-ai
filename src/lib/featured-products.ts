export type FeaturedProductBrand = {
  bg: string;
  fg: string;
  mutedFg: string;
  accent: string;
  accentFg: string;
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
    approvedAt: "2026-06-20",
  },
];

export function getFeaturedProducts(): FeaturedProduct[] {
  return PRODUCTS.filter((p) => p.approvedAt !== null);
}

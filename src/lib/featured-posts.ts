export type FeaturedPost = {
  slug: string;
  eyebrow: string;
  title: string;
  dek: string;
  url: string;
  cta: string;
  publishedAt: string;
  authors: string;
  accent: string;
  bg: string;
  fg: string;
  mutedFg: string;
};

const POSTS: FeaturedPost[] = [
  {
    slug: "mac-deck-command",
    eyebrow: "Community / Feature post",
    title: "MaC can compete with Gamma and Figma now.",
    dek: "Last week we said we wouldn't build our own versions. Then we did. Then we shipped one that beat Gamma's output on the same brief.",
    url: "https://decks.makeacompany.ai/mac-deck-command/",
    cta: "Read the post",
    publishedAt: "2026-06-20",
    authors: "Ross & John Osberg",
    accent: "#9ab8ff",
    bg: "#0a0a0a",
    fg: "#f5f5f5",
    mutedFg: "#a3a3a3",
  },
  {
    slug: "brandlete-orange-crush",
    eyebrow: "Partner pitch · Built in MaC",
    title: "Orange Crush × Brandlete — Founding Partnership Opportunity",
    dek: "WNY's #1 club lacrosse meets a platform built for clubs. Rendered through MaC's deck-polish skill in a single Slack thread.",
    url: "https://decks.makeacompany.ai/brandlete-orange-crush/",
    cta: "See the deck",
    publishedAt: "2026-06-20",
    authors: "Brandlete team",
    accent: "#4A90E2",
    bg: "#0A0F1A",
    fg: "#ffffff",
    mutedFg: "#A9B3C2",
  },
];

export function getFeaturedPosts(): FeaturedPost[] {
  return POSTS;
}

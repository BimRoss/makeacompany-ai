export type MoreSection = { id: string; label: string };

// Sections lifted from the full incubator site (/fullmac) into the "explore"
// tray on the homepage and the /more page it links to. The homepage itself is
// untouched — these live one tap away behind the nav tray.
//
// Deliberately EXCLUDED as too revealing to competitors: the harness moat
// ("the model is rented, the harness is ours"), the harness-vs-agent analogy,
// and built-from-inside. Those stay only on /fullmac.
export const MORE_SECTIONS: MoreSection[] = [
  { id: "agents-for", label: "A MaC Agent for every job" },
  { id: "problem", label: "The problem" },
  { id: "leverage", label: "Leverage" },
  { id: "who", label: "Who it's for" },
  { id: "why-founders", label: "Why founders" },
  { id: "community", label: "Community" },
  { id: "portfolio", label: "Portfolio" },
  { id: "process", label: "How it works" },
  { id: "team", label: "Ross & Joanne" },
  { id: "founders", label: "Founders" },
  { id: "faq", label: "FAQ" },
];

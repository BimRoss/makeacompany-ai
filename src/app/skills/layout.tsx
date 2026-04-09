import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Skills",
  robots: { index: false, follow: false },
};

export default function SkillsLayout({ children }: { children: ReactNode }) {
  return children;
}

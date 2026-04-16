import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents — makeacompany.ai",
  alternates: { canonical: "/agents" },
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Employees",
  robots: { index: false, follow: false },
};

export default function EmployeesLayout({ children }: { children: ReactNode }) {
  return children;
}

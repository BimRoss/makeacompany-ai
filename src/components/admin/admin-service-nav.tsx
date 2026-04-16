"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links: { href: string; label: string }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/twitter", label: "Twitter stack" },
  { href: "/slack-orchestrator", label: "Slack orchestrator" },
  { href: "/agents", label: "Agents" },
  { href: "/employees", label: "Employees" },
];

export function AdminServiceNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Operator observability"
      className="flex flex-wrap gap-1.5 rounded-xl border border-border/80 bg-muted/20 px-2 py-2 sm:gap-2 sm:px-3"
    >
      {links.map(({ href, label }) => {
        const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium motion-colors sm:text-sm ${
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/80 hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

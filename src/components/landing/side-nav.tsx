"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

type Anchor = { href: string; label: string };

const ANCHORS: Anchor[] = [
  { href: "#start", label: "Start" },
  { href: "#products", label: "Products" },
  { href: "#why", label: "Why this" },
  { href: "#how", label: "How it works" },
  { href: "#built", label: "Built from inside" },
  { href: "#pricing", label: "Pricing" },
  { href: "#testimonials", label: "Testimonials" },
];

export function SideNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed left-3 top-[4.25rem] z-[60] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-md backdrop-blur-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 sm:left-5 sm:top-[4.5rem] sm:h-11 sm:w-11"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[55] bg-foreground/30 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Section navigation"
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-[56] h-full w-72 max-w-[85vw] border-r border-border bg-background shadow-2xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Jump to
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/70 hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <nav className="flex flex-col p-3">
          {ANCHORS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-base font-medium text-foreground/85 hover:bg-muted hover:text-foreground"
            >
              {a.label}
            </a>
          ))}
        </nav>
      </aside>
    </>
  );
}

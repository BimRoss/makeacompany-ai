"use client";

import { Menu, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

type SideNavCtx = { open: boolean; setOpen: (v: boolean) => void };

const SideNavContext = createContext<SideNavCtx | null>(null);

export function SideNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <SideNavContext.Provider value={value}>{children}</SideNavContext.Provider>;
}

function useSideNavCtx(): SideNavCtx | null {
  return useContext(SideNavContext);
}

export function useSideNav(): SideNavCtx | null {
  return useSideNavCtx();
}

export function SideNavTrigger({ className = "" }: { className?: string }) {
  const ctx = useSideNavCtx();
  if (!ctx) return null;
  const { open, setOpen } = ctx;
  return (
    <button
      type="button"
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={
        "relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 motion-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97] " +
        className
      }
    >
      {open ? <X className="h-[1.125rem] w-[1.125rem]" aria-hidden /> : <Menu className="h-[1.125rem] w-[1.125rem]" aria-hidden />}
    </button>
  );
}

export function SideNav() {
  const ctx = useSideNavCtx();
  const open = ctx?.open ?? false;
  const setOpen = ctx?.setOpen ?? (() => {});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[55] bg-foreground/30 transition-opacity duration-200 ease-out ${
          open ? "opacity-100 backdrop-blur-sm" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Section navigation"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[56] h-full w-72 max-w-[85vw] border-l border-border bg-background shadow-2xl transition-[transform,opacity] duration-[240ms] ease-out ${
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-4 opacity-0"
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

"use client";

import Image from "next/image";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function Header() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <header
      className={`sticky top-0 z-50 px-3 motion-all sm:px-5 ${
        isScrolled ? "pt-2" : "pt-3"
      }`}
    >
      <div
        className={`group relative mx-auto flex w-full max-w-6xl items-center justify-between overflow-hidden rounded-3xl px-5 motion-all sm:px-8 ${
          isScrolled
            ? "h-14 bg-white/62 shadow-[0_18px_52px_rgba(0,0,0,0.14),0_2px_8px_rgba(255,255,255,0.25)_inset] backdrop-blur-2xl dark:bg-black/58 dark:shadow-[0_22px_64px_rgba(0,0,0,0.55),0_2px_8px_rgba(255,255,255,0.08)_inset]"
            : "h-16 bg-white/52 shadow-[0_14px_42px_rgba(0,0,0,0.1),0_2px_6px_rgba(255,255,255,0.22)_inset] backdrop-blur-xl dark:bg-black/50 dark:shadow-[0_16px_48px_rgba(0,0,0,0.48),0_2px_6px_rgba(255,255,255,0.08)_inset]"
        }`}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-0 motion-all group-hover:translate-x-[360%] group-hover:opacity-100 dark:via-white/20" />
        </div>
        <div className="flex items-center gap-3">
          <Image
            src="/makeacompany-mark-c.png"
            alt="Make a Company logo mark"
            width={40}
            height={40}
            className="h-10 w-10 rounded-md object-contain"
          />
          <p
            className={`font-display text-lg font-semibold tracking-[-0.03em] motion-colors sm:text-xl ${
              isScrolled ? "opacity-95" : "opacity-100"
            }`}
          >
            Make a Company{" "}
            <span className="font-sans text-base font-medium tracking-[-0.015em] text-muted-foreground sm:text-lg">
              .ai
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label="Toggle theme"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg bg-background/45 shadow-[0_6px_16px_rgba(0,0,0,0.12)] motion-colors hover:bg-accent hover:text-accent-foreground dark:shadow-[0_8px_18px_rgba(0,0,0,0.5)]"
        >
          {!mounted ? (
            <span className="h-5 w-5" />
          ) : (
            <>
              <Sun className="h-5 w-5 rotate-0 scale-100 motion-transform dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 motion-transform dark:rotate-0 dark:scale-100" />
            </>
          )}
        </button>
      </div>
    </header>
  );
}

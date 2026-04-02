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
            ? "h-14 bg-white/62 shadow-[0_18px_52px_rgba(0,0,0,0.14),0_2px_8px_rgba(255,255,255,0.25)_inset] backdrop-blur-2xl dark:bg-black/58 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_22px_64px_-12px_rgba(255,255,255,0.1),0_8px_28px_-8px_rgba(255,255,255,0.06),0_2px_10px_rgba(255,255,255,0.14)_inset]"
            : "h-16 bg-white/52 shadow-[0_14px_42px_rgba(0,0,0,0.1),0_2px_6px_rgba(255,255,255,0.22)_inset] backdrop-blur-xl dark:bg-black/50 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.09),0_18px_56px_-14px_rgba(255,255,255,0.08),0_6px_24px_-8px_rgba(255,255,255,0.05),0_2px_8px_rgba(255,255,255,0.12)_inset]"
        }`}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-0 motion-all group-hover:translate-x-[360%] group-hover:opacity-100 dark:via-white/20" />
        </div>
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="makeacompany.ai logo"
            width={40}
            height={40}
            className="h-10 w-10 rounded-md object-contain"
          />
          <p
            className={`font-display text-lg font-semibold tracking-[-0.03em] text-muted-foreground motion-colors sm:text-xl ${
              isScrolled ? "opacity-95" : "opacity-100"
            }`}
          >
            makeacompany.ai
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={
            mounted
              ? isDark
                ? "Switch to light mode"
                : "Switch to dark mode"
              : "Toggle color theme"
          }
          className="relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 motion-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97]"
        >
          {!mounted ? (
            <span className="inline-block h-5 w-5" aria-hidden />
          ) : (
            <>
              <Sun className="h-[1.125rem] w-[1.125rem] rotate-0 scale-100 motion-transform dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.125rem] w-[1.125rem] rotate-90 scale-0 motion-transform dark:rotate-0 dark:scale-100" />
            </>
          )}
        </button>
      </div>
    </header>
  );
}

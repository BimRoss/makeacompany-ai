"use client";

import Image from "next/image";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

import { useWorkspaceNavbarTrail } from "@/components/workspace-navbar-trail-provider";

type HeaderProps = {
  endSlot?: ReactNode;
};

export function Header({ endSlot }: HeaderProps = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const { trail: workspaceNavbarTrail, endLead: workspaceNavbarEndLead } = useWorkspaceNavbarTrail();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <header className="sticky top-0 z-50 px-3 pt-2 motion-all sm:px-5">
      <div className="group relative mx-auto flex h-14 w-full max-w-6xl items-center justify-between overflow-hidden rounded-3xl bg-white/62 px-5 shadow-[0_18px_52px_rgba(0,0,0,0.14),0_2px_8px_rgba(255,255,255,0.25)_inset] backdrop-blur-2xl motion-all dark:bg-black/58 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_22px_64px_-12px_rgba(255,255,255,0.1),0_8px_28px_-8px_rgba(255,255,255,0.06),0_2px_10px_rgba(255,255,255,0.14)_inset] sm:px-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-0 motion-all group-hover:translate-x-[360%] group-hover:opacity-100 dark:via-white/20" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Link href="/" aria-label="Go to homepage" className="flex shrink-0 items-center gap-3">
            <Image
              src="/logo.png"
              alt="makeacompany.ai logo"
              width={40}
              height={40}
              className="h-10 w-10 rounded-md object-contain"
            />
            <p className="font-display text-lg font-semibold tracking-[-0.03em] text-muted-foreground opacity-95 motion-colors sm:text-xl">
              makeacompany.ai
            </p>
          </Link>
          {workspaceNavbarTrail ? (
            <>
              <span className="shrink-0 select-none text-muted-foreground/40 motion-colors" aria-hidden>
                –
              </span>
              <div className="min-w-0 flex-1">{workspaceNavbarTrail}</div>
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2.5">
          {workspaceNavbarEndLead ? (
            <div className="flex min-w-0 max-w-[min(100vw-12rem,14rem)] items-center justify-end gap-1 sm:max-w-[18rem]">
              {workspaceNavbarEndLead}
            </div>
          ) : null}
          {endSlot}
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
      </div>
    </header>
  );
}

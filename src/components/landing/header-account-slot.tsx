"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, LogOut, User } from "lucide-react";

type AuthState = "unknown" | "signed_in" | "signed_out";

const ICON_BUTTON_CLASS =
  "relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 motion-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60";

export function HeaderAccountSlot() {
  const [state, setState] = useState<AuthState>("unknown");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/auth/me", { method: "GET", cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { authenticated?: boolean } | null;
          setState(body?.authenticated === true ? "signed_in" : "signed_out");
        } else {
          setState("signed_out");
        }
      } catch {
        if (!cancelled) setState("signed_out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "unknown") {
    // Reserve space without committing to either icon — avoids a layout
    // shift when the auth check resolves.
    return <span className="inline-block h-11 w-11 shrink-0" aria-hidden />;
  }

  if (state === "signed_in") {
    return (
      <button
        type="button"
        onClick={async () => {
          if (loggingOut) return;
          setLoggingOut(true);
          try {
            await fetch("/api/me/auth/logout", { method: "POST", cache: "no-store" });
          } catch {
            // best effort — fall through to reload below
          }
          window.location.assign("/");
        }}
        disabled={loggingOut}
        aria-busy={loggingOut}
        aria-label={loggingOut ? "Logging out" : "Log out"}
        className={ICON_BUTTON_CLASS}
      >
        {loggingOut ? (
          <Loader2 className="h-[1.125rem] w-[1.125rem] shrink-0 animate-spin" aria-hidden />
        ) : (
          <LogOut className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
        )}
      </button>
    );
  }

  return (
    <Link href="/me/login" aria-label="Sign in to your account" className={ICON_BUTTON_CLASS}>
      <User className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
    </Link>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const TOAST_MS = 6000;

export type PortalPostAuthWelcomeToastProps = {
  /** Set after workspace loads Slack profiles + session email; cleared after timeout or dismiss. */
  welcome: null | {
    greeting: string;
    portraitUrl?: string;
  };
  onDismiss: () => void;
};

/**
 * Pill toast after OAuth or magic-link sign-in — copy matches landing checkout return styling.
 * Greeting is built upstream (session email + Slack profiles / workspace user + email local-part fallback).
 */
export function PortalPostAuthWelcomeToast({ welcome, onDismiss }: PortalPostAuthWelcomeToastProps) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!welcome) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onDismissRef.current();
    }, TOAST_MS);
    return () => clearTimeout(timer);
  }, [welcome]);

  if (!welcome || !visible) {
    return null;
  }

  const url = welcome.portraitUrl?.trim();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[min(100%,28rem)] items-center gap-2.5 rounded-full border border-foreground bg-background py-2 pl-2 pr-5 shadow-lg">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-9 shrink-0 rounded-full border border-border object-cover" />
        ) : null}
        <p className="min-w-0 text-sm font-medium leading-snug text-foreground">{welcome.greeting}</p>
      </div>
    </div>
  );
}

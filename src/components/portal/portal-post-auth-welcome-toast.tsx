"use client";

import { useEffect, useState } from "react";

const WELCOME_PARAM = "portal_welcome";
const TOAST_MS = 6000;

function stripWelcomeParam() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(WELCOME_PARAM)) {
    return;
  }
  params.delete(WELCOME_PARAM);
  const q = params.toString();
  const nextURL = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextURL);
}

/**
 * Pill toast matching the landing checkout return — shown once after OAuth or magic-link sign-in.
 */
export function PortalPostAuthWelcomeToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(WELCOME_PARAM)?.trim() !== "1") {
      return;
    }
    setMessage("Welcome! You're signed in to your company workspace.");
    stripWelcomeParam();
  }, []);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <p className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium shadow-lg">
        {message}
      </p>
    </div>
  );
}

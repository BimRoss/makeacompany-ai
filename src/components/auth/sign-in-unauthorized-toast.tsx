"use client";

import { useEffect, useState } from "react";

const TOAST_MS = 6000;

function stripAuthQueryParam() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("auth")) {
    return;
  }
  params.delete("auth");
  const q = params.toString();
  const nextURL = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextURL);
}

/**
 * One-shot pill toast when OAuth / magic-link redirects with ?auth=unauthorized.
 * Clears the param from the URL so refresh does not repeat the toast.
 */
export function SignInUnauthorizedToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth")?.trim() !== "unauthorized") {
      return;
    }
    setVisible(true);
    stripAuthQueryParam();
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <p
        className="pointer-events-auto max-w-lg text-pretty rounded-full border border-destructive/40 bg-background px-5 py-2 text-center text-sm font-medium text-destructive shadow-lg"
        role="alert"
      >
        {message}
      </p>
    </div>
  );
}

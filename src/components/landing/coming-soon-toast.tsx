"use client";

import { useEffect, useState } from "react";

const TOAST_MS = 3000;
export const COMING_SOON_EVENT = "mac:coming-soon";

export function dispatchComingSoon() {
  window.dispatchEvent(new Event(COMING_SOON_EVENT));
}

export function ComingSoonToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(COMING_SOON_EVENT, handler);
    return () => window.removeEventListener(COMING_SOON_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      <p className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium shadow-lg">
        Coming Soon!
      </p>
    </div>
  );
}

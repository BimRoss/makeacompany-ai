"use client";

import { useLayoutEffect, useState } from "react";

const MD_MEDIA = "(min-width: 768px)";

/** Read the live viewport width (Tailwind `md:`). Only call from client `useLayoutEffect` / event handlers. */
export function readIsMdLayoutViewport(): boolean {
  return window.matchMedia(MD_MEDIA).matches;
}

/**
 * `true` when viewport is `md` breakpoint or wider (Tailwind `md:`).
 * Defaults to `true` for SSR and first paint; updates synchronously before paint on the client.
 */
export function useIsMdLayout(): boolean {
  const [isMd, setIsMd] = useState(true);

  useLayoutEffect(() => {
    const mq = window.matchMedia(MD_MEDIA);
    const apply = () => setIsMd(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return isMd;
}

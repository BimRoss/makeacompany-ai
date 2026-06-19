"use client";

import { useEffect } from "react";
import { firstTouchToGtagParams, readFirstTouchClient } from "@/lib/first-touch";
import { track } from "@/lib/gtag";
import type { Persona } from "@/lib/personas";

type Props = { persona: Persona; slug: string };

export function PersonaPageView({ persona, slug }: Props) {
  useEffect(() => {
    const firstTouch = readFirstTouchClient();
    track("persona_page_view", {
      persona,
      persona_slug: slug,
      page_path: typeof window !== "undefined" ? window.location.pathname : `/for/${slug}`,
      ...firstTouchToGtagParams(firstTouch),
    });
  }, [persona, slug]);
  return null;
}

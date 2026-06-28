"use client";

import { usePersona } from "@/components/landing/persona-context";
import { firstTouchToGtagParams, readFirstTouchClient } from "@/lib/first-touch";
import { PERSONA_LABELS, PERSONA_SLUGS, PERSONAS, type Persona } from "@/lib/personas";
import { track } from "@/lib/gtag";
import { dispatchComingSoon } from "@/components/landing/coming-soon-toast";

export function PersonaSelector() {
  const { persona, selected } = usePersona();
  const activeIndex = PERSONAS.indexOf(persona);

  return (
    <div
      role="tablist"
      aria-label="Who are you?"
      className="relative mx-auto grid w-full max-w-lg grid-cols-4 rounded-full border border-border bg-background p-0.5 text-sm font-medium shadow-sm"
    >
      {/* Sliding pill highlight — hidden when no persona is selected. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full bg-foreground transition-all duration-300 ease-out"
        style={{
          width: "calc((100% - 0.25rem) / 4)",
          transform: `translateX(${activeIndex * 100}%)`,
          opacity: selected ? 1 : 0,
        }}
      />
      {PERSONAS.map((p: Persona) => {
        const active = selected && p === persona;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              track("persona_selected", {
                persona: PERSONA_SLUGS[p],
                from: persona,
                ...firstTouchToGtagParams(readFirstTouchClient()),
              });
              dispatchComingSoon();
            }}
            className={`relative z-10 rounded-full px-2 py-1.5 transition-colors sm:px-3 ${
              active ? "text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {PERSONA_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}

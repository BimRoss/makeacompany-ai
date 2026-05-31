"use client";

import { usePersona } from "@/components/landing/persona-context";
import { PERSONA_LABELS, PERSONAS, type Persona } from "@/lib/personas";

export function PersonaSelector() {
  const { persona, setPersona } = usePersona();
  const activeIndex = PERSONAS.indexOf(persona);

  return (
    <div
      role="tablist"
      aria-label="Who are you?"
      className="relative mx-auto grid w-full max-w-lg grid-cols-4 rounded-full border border-border bg-background p-1 text-sm font-medium shadow-sm"
    >
      {/* Sliding pill highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-foreground transition-transform duration-300 ease-out"
        style={{
          width: "calc((100% - 0.5rem) / 4)",
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {PERSONAS.map((p: Persona) => {
        const active = p === persona;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setPersona(p)}
            className={`relative z-10 rounded-full px-3 py-2 transition-colors ${
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

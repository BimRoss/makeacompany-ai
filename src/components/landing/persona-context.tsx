"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_PERSONA,
  PERSONA_COPY,
  type Persona,
  type PersonaCopy,
  type PersonaSource,
  persistPersona,
  resolveInitialPersona,
} from "@/lib/personas";

interface PersonaContextValue {
  persona: Persona;
  copy: PersonaCopy;
  setPersona: (next: Persona) => void;
  /** True once the client has resolved the persona from URL/storage/referrer. */
  hydrated: boolean;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function fireSwitchEvent(from: Persona, to: Persona, source: PersonaSource) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "persona_switch", {
    event_category: "engagement",
    from,
    to,
    source,
  });
}

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(DEFAULT_PERSONA);
  const [hydrated, setHydrated] = useState(false);
  const lastRef = useRef<Persona>(DEFAULT_PERSONA);

  useEffect(() => {
    const resolved = resolveInitialPersona();
    lastRef.current = resolved.persona;
    setPersonaState(resolved.persona);
    setHydrated(true);
    if (resolved.source !== "default") {
      // Only fire when the initial choice came from a real signal.
      fireSwitchEvent(DEFAULT_PERSONA, resolved.persona, resolved.source);
    }
  }, []);

  const setPersona = useCallback((next: Persona) => {
    setPersonaState((prev) => {
      if (prev === next) return prev;
      fireSwitchEvent(prev, next, "click");
      persistPersona(next);
      lastRef.current = next;
      return next;
    });
  }, []);

  const value: PersonaContextValue = {
    persona,
    copy: PERSONA_COPY[persona],
    setPersona,
    hydrated,
  };

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) {
    throw new Error("usePersona must be used within a PersonaProvider");
  }
  return ctx;
}

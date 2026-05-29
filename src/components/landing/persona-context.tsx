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
import { captureRefFromUrl } from "@/lib/ref";

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

interface PersonaProviderProps {
  children: React.ReactNode;
  /** Persona resolved on the server (URL param or default). Used as initial state so SSR copy matches the hydrated copy. */
  initialPersona?: Persona;
  /** True when `initialPersona` came from the URL — skip URL re-resolution on the client to avoid double work. */
  initialFromUrl?: boolean;
}

export function PersonaProvider({
  children,
  initialPersona = DEFAULT_PERSONA,
  initialFromUrl = false,
}: PersonaProviderProps) {
  const [persona, setPersonaState] = useState<Persona>(initialPersona);
  const [hydrated, setHydrated] = useState(false);
  const lastRef = useRef<Persona>(initialPersona);

  useEffect(() => {
    captureRefFromUrl();
    // If the URL pinned the persona server-side, trust it — no client upgrade.
    if (initialFromUrl) {
      setHydrated(true);
      return;
    }
    const resolved = resolveInitialPersona(true);
    if (resolved.persona !== initialPersona) {
      lastRef.current = resolved.persona;
      setPersonaState(resolved.persona);
      fireSwitchEvent(initialPersona, resolved.persona, resolved.source);
    }
    setHydrated(true);
  }, [initialFromUrl, initialPersona]);

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

export type Persona = "founder" | "engineer" | "team";

export const PERSONAS: ReadonlyArray<Persona> = ["founder", "engineer", "team"];

export const PERSONA_LABELS: Record<Persona, string> = {
  founder: "Founder",
  engineer: "Engineer",
  team: "Team",
};

export interface PersonaCopy {
  heroLine1: string;
  heroLine2: string;
  subhead: string;
  ctaH2: string;
  ctaParagraph: string;
  ctaButtonLabel: string;
}

export const PERSONA_COPY: Record<Persona, PersonaCopy> = {
  founder: {
    heroLine1: "Your whole company,",
    heroLine2: "running in Slack.",
    subhead:
      "Joanne handles ops. Ross ships code. You make the calls only a founder can — for what one Claude seat costs.",
    ctaH2: "Start your company.",
    ctaParagraph:
      "Drop your email. Joanne sends you a Slack invite and your AI team is in there waiting.",
    ctaButtonLabel: "Start your company",
  },
  engineer: {
    heroLine1: "$99/mo replaces Claude Max —",
    heroLine2: "and ships in Slack already.",
    subhead:
      "We sell the harness, not the agent. Persistent workspaces per channel, baked-in skills, GitOps wired up. Built by an engineer who clears your hiring bar.",
    ctaH2: "See the harness.",
    ctaParagraph:
      "Drop your email. You'll be in Slack with the agents and the full kit in minutes — the same setup the founder uses to ship this product.",
    ctaButtonLabel: "See the harness",
  },
  team: {
    heroLine1: "AI teammates,",
    heroLine2: "where your team already works.",
    subhead:
      "Slack-native agents that live in your channels. Persistent workspaces, recurring loops, GitOps baked in. No new tool to roll out — they show up where you already are.",
    ctaH2: "Add it to your Slack.",
    ctaParagraph:
      "Drop your work email. We'll get your team into a Slack workspace with Joanne and Ross ready to go.",
    ctaButtonLabel: "Add to your Slack",
  },
};

export const DEFAULT_PERSONA: Persona = "founder";

const STORAGE_KEY = "mac.persona";
const URL_PARAM = "p";

function isPersona(v: unknown): v is Persona {
  return v === "founder" || v === "engineer" || v === "team";
}

export type PersonaSource = "url" | "storage" | "referrer" | "default" | "click";

export interface ResolvedPersona {
  persona: Persona;
  source: PersonaSource;
}

/**
 * Resolve initial persona on first client load.
 * Precedence: URL param → localStorage → referrer sniff → default.
 */
export function resolveInitialPersona(): ResolvedPersona {
  if (typeof window === "undefined") {
    return { persona: DEFAULT_PERSONA, source: "default" };
  }

  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(URL_PARAM);
  if (isPersona(fromUrl)) return { persona: fromUrl, source: "url" };

  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    if (isPersona(fromStorage)) return { persona: fromStorage, source: "storage" };
  } catch {
    // Storage may be blocked (private mode, embedded contexts) — fall through.
  }

  const fromRef = sniffReferrer(document.referrer);
  if (fromRef) return { persona: fromRef, source: "referrer" };

  return { persona: DEFAULT_PERSONA, source: "default" };
}

const ENGINEER_HOSTS = [
  "news.ycombinator.com",
  "ycombinator.com",
  "github.com",
  "github.io",
  "stackoverflow.com",
  "dev.to",
  "lobste.rs",
  "reddit.com",
];

const FOUNDER_HOSTS = ["linkedin.com", "producthunt.com"];

function matchesHost(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

function sniffReferrer(ref: string): Persona | null {
  if (!ref) return null;
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (ENGINEER_HOSTS.some((h) => matchesHost(host, h))) return "engineer";
  if (FOUNDER_HOSTS.some((h) => matchesHost(host, h))) return "founder";
  return null;
}

export function persistPersona(p: Persona): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, p);
  } catch {
    // Ignore — best-effort persistence.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get(URL_PARAM) !== p) {
    url.searchParams.set(URL_PARAM, p);
    window.history.replaceState({}, "", url.toString());
  }
}

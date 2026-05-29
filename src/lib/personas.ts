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
    heroLine1: "Your next hire costs $150K/yr.",
    heroLine2: "This one costs $99/mo.",
    subhead:
      "Joanne runs ops. Ross ships code. You make the calls only a founder can — for what one Claude seat costs, and a fraction of your next contractor invoice.",
    ctaH2: "Start your company.",
    ctaParagraph:
      "Drop your email. Joanne sends you a Slack invite and your AI team is in there waiting.",
    ctaButtonLabel: "Start your company",
  },
  engineer: {
    heroLine1: "The harness your team",
    heroLine2: "wishes you'd bought sooner.",
    subhead:
      "We sell the harness, not the agent. Persistent workspaces per channel, baked-in skills, GitOps wired up. Built by an engineer who clears your hiring bar — shipping from the same product you'd be buying.",
    ctaH2: "See the harness.",
    ctaParagraph:
      "Drop your email. You'll be in Slack with the agents and the full kit in minutes — the same setup the founder uses to ship this product.",
    ctaButtonLabel: "See the harness",
  },
  team: {
    heroLine1: "AI teammates",
    heroLine2: "where you already work.",
    subhead:
      "Your next ops hire costs $80K/yr. Joanne and Ross cost $99/mo, start today, and live in the Slack you're already in. No new tool to roll out.",
    ctaH2: "Add it to your Slack.",
    ctaParagraph:
      "Drop your work email. We'll get your team into a Slack workspace with Joanne and Ross ready to go.",
    ctaButtonLabel: "Add to your Slack",
  },
};

export const DEFAULT_PERSONA: Persona = "founder";

/**
 * URL slug for each persona on the `/for/<slug>` routes. Plural reads more
 * naturally in URLs ("makeacompany.ai/for/founders") than the singular keys
 * we use internally.
 */
export const PERSONA_SLUGS: Record<Persona, string> = {
  founder: "founders",
  engineer: "engineers",
  team: "teams",
};

export const PERSONA_BY_SLUG: Record<string, Persona> = Object.fromEntries(
  (Object.entries(PERSONA_SLUGS) as Array<[Persona, string]>).map(([persona, slug]) => [
    slug,
    persona,
  ]),
);

export interface PersonaMeta {
  /** `<title>` for the `/for/<slug>` page. */
  title: string;
  /** Meta description + OG description. */
  description: string;
  /** OG image alt. */
  ogAlt: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  founder: {
    title: "AI company for founders — makeacompany.ai",
    description:
      "Run your whole company from Slack. Joanne handles ops, Ross ships code, you make the calls only a founder can. $99/month — one Claude seat for an entire AI team.",
    ogAlt: "makeacompany.ai for founders — AI company in Slack for $99/month",
  },
  engineer: {
    title: "Claude in Slack for engineers — makeacompany.ai",
    description:
      "$99/month for Claude that ships code in Slack. Persistent workspaces per channel, baked-in skills, GitOps wired up. The harness, not just the agent.",
    ogAlt: "makeacompany.ai for engineers — Claude that ships code in Slack",
  },
  team: {
    title: "AI teammates in Slack — makeacompany.ai for teams",
    description:
      "Slack-native AI teammates that live in your channels. Persistent workspaces, recurring loops, GitOps baked in. No new tool to roll out — they show up where you already work.",
    ogAlt: "makeacompany.ai for teams — Slack-native AI teammates",
  },
};

const STORAGE_KEY = "mac.persona";
const URL_PARAM = "p";

function isPersona(v: unknown): v is Persona {
  return v === "founder" || v === "engineer" || v === "team";
}

/**
 * Parse the persona search param on the server. Returns null when the
 * value is missing or unrecognized so the caller can fall back to the default.
 */
export function parsePersonaParam(v: unknown): Persona | null {
  if (Array.isArray(v)) v = v[0];
  return isPersona(v) ? v : null;
}

export type PersonaSource = "url" | "storage" | "referrer" | "default" | "click";

export interface ResolvedPersona {
  persona: Persona;
  source: PersonaSource;
}

/**
 * Resolve initial persona on first client load.
 * Precedence: URL param → localStorage → referrer sniff → default.
 *
 * When `skipUrl` is true the URL has already been honored server-side; only
 * storage/referrer get a chance to upgrade the persona post-hydration.
 */
export function resolveInitialPersona(skipUrl = false): ResolvedPersona {
  if (typeof window === "undefined") {
    return { persona: DEFAULT_PERSONA, source: "default" };
  }

  if (!skipUrl) {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(URL_PARAM);
    if (isPersona(fromUrl)) return { persona: fromUrl, source: "url" };
  }

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

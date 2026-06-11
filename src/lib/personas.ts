export type Persona = "founder" | "engineer" | "team" | "contractor";

export const PERSONAS: ReadonlyArray<Persona> = [
  "engineer",
  "founder",
  "team",
  "contractor",
];

export const PERSONA_LABELS: Record<Persona, string> = {
  founder: "Founders",
  engineer: "Engineers",
  team: "Teams",
  contractor: "Contractors",
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
    heroLine1: "Two hires cost $300k/yr.",
    heroLine2: "These are $99/mo.",
    subhead:
      "Joanne runs ops. Ross ships code. You make the calls only a founder can — for what one Claude seat costs.",
    ctaH2: "Start your company.",
    ctaParagraph:
      "Drop your email. Joanne sends you a Slack invite and your AI team is in there waiting.",
    ctaButtonLabel: "Start your company",
  },
  engineer: {
    heroLine1: "AI raised the bar.",
    heroLine2: "Here's your harness.",
    subhead:
      "Push PRs from your phone. Watch deploys finish while you're at lunch. The same Claude Code you run locally, except it lives in a pod with GitHub, Slack, and your repos already wired up. $99/month, one Claude seat.",
    ctaH2: "Get a hosted Claude.",
    ctaParagraph:
      "Drop your email. We'll spin up a Slack workspace with your own Claude Code agent ready to clone repos and open PRs.",
    ctaButtonLabel: "Get hosted Claude",
  },
  team: {
    heroLine1: "AI teammates,",
    heroLine2: "Where you already work.",
    subhead:
      "Joanne triages your #support channel, runs standups, drafts customer replies, syncs Google Workspace. Ross merges PRs, watches deploys, files tickets from threads. Both live in the Slack channels you already use — no new dashboard, no SSO setup. $99/month for the pair, live in five minutes.",
    ctaH2: "Add them to your Slack.",
    ctaParagraph:
      "Drop your work email. We'll provision a Slack workspace with Joanne and Ross already in your channels and ready to pick up tasks.",
    ctaButtonLabel: "Add to your Slack",
  },
  contractor: {
    heroLine1: "Agencies charge $5k/mo.",
    heroLine2: "We charge $99.",
    subhead:
      "Ross pairs with you in Slack — pushes branches, opens PRs, watches deploys. Joanne handles client comms and invoicing. Senior-team output, no headcount to manage.",
    ctaH2: "Get the unfair advantage.",
    ctaParagraph:
      "Drop your email. We'll get you into a Slack workspace with Ross and Joanne ready to ship.",
    ctaButtonLabel: "Get started",
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
  contractor: "contractors",
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
    title: "AI company for founders",
    description:
      "Run your whole company from Slack. Joanne handles ops, Ross ships code, you make the calls only a founder can. $99/month — one Claude seat for an entire AI team.",
    ogAlt: "makeacompany.ai for founders — AI company in Slack for $99/month",
  },
  engineer: {
    title: "Hosted Claude Code in Slack for engineers",
    description:
      "Run Claude Code from Slack instead of your laptop. Persistent pods with GitHub + your repos pre-wired. Ship PRs from anywhere. $99/month for one seat.",
    ogAlt:
      "makeacompany.ai for engineers — hosted Claude Code that ships PRs from your Slack",
  },
  team: {
    title: "AI ops + engineering teammates for Slack teams",
    description:
      "Joanne handles ops, Ross handles code, both live in your existing Slack channels. No new tool to roll out. $99/month for the pair — your team is shipping by lunch.",
    ogAlt:
      "makeacompany.ai for teams — Joanne and Ross live in your Slack channels",
  },
  contractor: {
    title: "AI teammates for contractors",
    description:
      "Solo developer? Ship like a small team. Ross pairs in Slack, Joanne handles client comms and invoicing. $99/month — bill senior rates without senior overhead.",
    ogAlt:
      "makeacompany.ai for contractors — ship like a small team for $99/month",
  },
};

const STORAGE_KEY = "mac.persona";
const URL_PARAM = "p";

function isPersona(v: unknown): v is Persona {
  return (
    v === "founder" || v === "engineer" || v === "team" || v === "contractor"
  );
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

const CONTRACTOR_HOSTS = ["upwork.com", "toptal.com", "freelancer.com"];

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
  if (CONTRACTOR_HOSTS.some((h) => matchesHost(host, h))) return "contractor";
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

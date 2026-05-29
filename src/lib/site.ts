/** Domain / URL identity (header, manifest, JSON-LD WebSite name) */
export const siteDomainLabel = "makeacompany.ai";
/** Back-compat: same as domain-first branding */
export const siteName = siteDomainLabel;

/** Primary headline lines — hero H1 */
export const siteTaglineLine1 = "Your next hire costs $150K.";
export const siteTaglineLine2 = "This one costs $99/mo.";

/** Single-line headline for `<title>`, OG alt, and other one-string contexts */
export const siteTagline = `${siteTaglineLine1} ${siteTaglineLine2}`;

/** Hero subhead under H1; the short, punchy line used on social shares. */
export const siteDescriptionLine2 = "AI does the work. You make the calls.";

/** Short OG/Twitter unfurl description — kept punchy for link previews. */
export const siteSocialDescription = siteDescriptionLine2;

/**
 * SERP meta description — keyword-rich and within Google's ~155-char render window.
 * Distinct from `siteSocialDescription` so social unfurls stay punchy while search results stay informative.
 */
export const siteDescription =
  "Slack-native AI teammates for founders and lean teams. Ross ships code, Joanne runs ops — one $99/month Claude seat backs a whole role-based AI team in Slack.";

/**
 * `<title>` — keyword-rich for SERP visibility. The brand tagline (`siteTagline`)
 * is preserved for OG/Twitter titles so social shares keep the marketing voice.
 */
export const siteTitle = "makeacompany.ai — AI team in Slack for $99/mo";

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://makeacompany.ai";

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL?.replace(/\/$/, "") || "";
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

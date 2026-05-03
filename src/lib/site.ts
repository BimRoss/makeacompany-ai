/** Domain / URL identity (header, manifest, JSON-LD WebSite name) */
export const siteDomainLabel = "makeacompany.ai";
/** Back-compat: same as domain-first branding */
export const siteName = siteDomainLabel;

/** Primary headline lines — hero H1 */
export const siteTaglineLine1 = "Deploy an AI team";
export const siteTaglineLine2 = "in seconds";

/** Single-line headline for `<title>`, OG alt, and other one-string contexts */
export const siteTagline = `${siteTaglineLine1} ${siteTaglineLine2}`;

/** Subhead lines — hero H2 (both lines); link previews use `siteDescription` only */
export const siteDescriptionLine1 = "Create an AI-native department in 3 clicks.";
export const siteDescriptionLine2 = "For companies who want departments at a fraction of the cost.";

/**
 * Meta / Open Graph / Twitter / manifest / JSON-LD — short unfurl description.
 */
export const siteDescription = siteDescriptionLine2;

/**
 * Default `<title>` — matches primary headline so tabs and unfurls lead with the product promise.
 */
export const siteTitle = siteTagline;

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://makeacompany.ai";

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL?.replace(/\/$/, "") || "";
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

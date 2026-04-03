/** Domain / URL identity (header, manifest, JSON-LD WebSite name) */
export const siteDomainLabel = "makeacompany.ai";
/** Back-compat: same as domain-first branding */
export const siteName = siteDomainLabel;

/** Primary headline — hero H1, Open Graph / Twitter title */
export const siteTagline = "Make a Company for $1";

/**
 * Subhead — meta description, hero secondary line, OG image secondary text.
 */
export const siteDescription = "Your AI company, live in Slack.";

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

/**
 * UTM taxonomy for the /marketing registry (issue #303). Mirrors the backend
 * `MarketingAllowedSources` / `MarketingAllowedMediums` lists so client-side
 * validation matches what the Go handler will accept. Update both sides when
 * adding a new channel (e.g. twitter, producthunt, hn).
 */

export const MARKETING_SOURCES = ["linkedin"] as const;
export type MarketingSource = (typeof MARKETING_SOURCES)[number];

export const MARKETING_MEDIUMS = ["social", "email", "referral", "cpc", "community"] as const;
export type MarketingMedium = (typeof MARKETING_MEDIUMS)[number];

/** Same regex the backend enforces in ValidateMarketingCampaign. */
export const MARKETING_KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const MARKETING_DEFAULT_TARGET_URL = "https://makeacompany.ai/";

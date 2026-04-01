export const siteName = "Make a Company";
export const siteTitle = "Your AI Company in Slack";
export const siteDescription =
  "Waitlist: AI employees in Slack for solo founders and lean teams—first 100 get a free month at launch. $1 refundable deposit.";
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://makeacompany.ai";

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL?.replace(/\/$/, "") || "";
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

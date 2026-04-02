export const siteName = "Make a Company";
/** Primary tagline for share cards and positioning */
export const siteTagline = "Make everyone a CEO.";
export const siteTitle = `Make a Company — ${siteTagline.replace(/\.$/, "")}.`;
export const siteDescription =
  "Waitlist: AI employees in Slack—leverage of a team without the headcount. $1 fully refundable deposit; first 100 get a free month at launch.";
/** One line under the headline on generated OG/Twitter images */
export const siteShareSubhead =
  "Keep the CEO seat. Let AI employees run the plays—in Slack, 24/7.";
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://makeacompany.ai";

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL?.replace(/\/$/, "") || "";
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

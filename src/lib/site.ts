export const siteName = "Make a Company";
export const siteTitle = "Make a Company — one human, infinite agents";
export const siteDescription =
  "Join the waitlist for the playbook and systems to build a trillion-dollar single-person company — company as code, proof over promises.";
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://makeacompany.ai";

export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL?.replace(/\/$/, "") || "";
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

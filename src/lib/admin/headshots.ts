import type { TeamMember } from "@/lib/admin/catalog";

const LOCAL_HEADSHOT_BASE_PATH = "/headshots";

const LOCAL_HEADSHOT_KEYS = new Set(["alex", "anna", "garth", "joanne", "ross", "tim"]);

function normalizeHeadshotKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getAdminHeadshotFallback(member: TeamMember): string {
  const fallbackValue = member.displayName.trim() || member.botDisplayName.trim() || member.id.trim();
  return fallbackValue.charAt(0).toUpperCase() || "?";
}

export function getAdminHeadshotGeneratedUrl(member: TeamMember): string {
  const fallback = getAdminHeadshotFallback(member);
  const bgColor = member.backgroundColor?.trim() || "#334155";
  const safeBgColor = /^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : "#334155";
  const escapedFallback = escapeXml(fallback);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${escapedFallback}"><rect width="96" height="96" fill="${safeBgColor}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff">${escapedFallback}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getAdminHeadshotLocalUrl(member: TeamMember): string | null {
  const candidates = [
    normalizeHeadshotKey(member.id),
    normalizeHeadshotKey(member.botDisplayName),
    normalizeHeadshotKey(member.displayName),
  ];
  const matchingKey = candidates.find((candidate) => LOCAL_HEADSHOT_KEYS.has(candidate));
  if (!matchingKey) {
    return null;
  }
  return `${LOCAL_HEADSHOT_BASE_PATH}/${matchingKey}.png`;
}

export function getAdminHeadshotUrl(
  member: TeamMember,
  opts?: { skipLocalPortraits?: boolean },
): string {
  if (opts?.skipLocalPortraits) {
    return getAdminHeadshotGeneratedUrl(member);
  }
  return getAdminHeadshotLocalUrl(member) ?? getAdminHeadshotGeneratedUrl(member);
}

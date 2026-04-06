import type { TeamMember } from "@/lib/admin/team";

const HEADSHOT_BASE_URL = "https://raw.githubusercontent.com/BimRoss/bimross-github/main/headshots";

const KNOWN_HEADSHOT_KEYS = new Set([
  "alex",
  "chloe",
  "garth",
  "isabella",
  "joanne",
  "maya",
  "mike",
  "ross",
  "sarah",
  "tim",
]);

function normalizeHeadshotKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function getAdminHeadshotUrl(member: TeamMember): string | null {
  const candidates = [
    normalizeHeadshotKey(member.id),
    normalizeHeadshotKey(member.botDisplayName),
    normalizeHeadshotKey(member.displayName),
  ];
  const matchingKey = candidates.find((candidate) => KNOWN_HEADSHOT_KEYS.has(candidate));
  if (!matchingKey) {
    return null;
  }
  return `${HEADSHOT_BASE_URL}/${matchingKey}.png`;
}

export function getAdminHeadshotFallback(member: TeamMember): string {
  const fallbackValue = member.displayName.trim() || member.botDisplayName.trim() || member.id.trim();
  return fallbackValue.charAt(0).toUpperCase() || "?";
}

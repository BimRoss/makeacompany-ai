/**
 * Human-readable label from a sign-in email when no richer profile name is available.
 */
export function displayNameFromAuthEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  const local = (at >= 0 ? trimmed.slice(0, at) : trimmed).trim();
  if (!local) {
    return "Signed in";
  }
  const words = local
    .replace(/[.+_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "Signed in";
  }
  return words.map((w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

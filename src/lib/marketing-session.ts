import { resolveAdminSessionBearerToken, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

/**
 * /marketing reuses the /admin Google sign-in cookie but layers a separate,
 * narrower allowlist on top: only `grant@bimross.com` and `johnosberg@gmail.com`
 * may load the page. The backend enforces the same list on every
 * `/v1/admin/marketing/campaigns` request — this client-side check just shapes
 * the page response (login redirect vs. 403 surface) before render.
 *
 * The allowlist also lives in backend env (`MARKETING_ALLOWLIST`); both sides
 * default to the same two emails when the env is unset.
 */
const MARKETING_ALLOWLIST = new Set<string>([
  "grant@bimross.com",
  "johnosberg@gmail.com",
]);

export type MarketingSessionResult =
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; email: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ok"; email: string };

export async function resolveMarketingSession(): Promise<MarketingSessionResult> {
  const token = await resolveAdminSessionBearerToken();
  if (!token) {
    return { kind: "unauthenticated" };
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/me`;
  try {
    const response = await fetch(backendURL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      return { kind: "unauthenticated" };
    }
    if (!response.ok) {
      return { kind: "unavailable", reason: `backend HTTP ${response.status}` };
    }
    const payload = (await response.json().catch(() => null)) as
      | { authenticated?: boolean; email?: string }
      | null;
    const email = (payload?.email ?? "").trim().toLowerCase();
    if (!payload?.authenticated || !email) {
      return { kind: "unauthenticated" };
    }
    if (!MARKETING_ALLOWLIST.has(email)) {
      return { kind: "forbidden", email };
    }
    return { kind: "ok", email };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { kind: "unavailable", reason: message };
  }
}

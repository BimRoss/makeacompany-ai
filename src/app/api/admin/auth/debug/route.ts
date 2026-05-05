import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin-session-cookie";
import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
} as const;

/**
 * Operator-only diagnostics for prod admin 401s. Gated by ADMIN_AUTH_DEBUG=1 on the Next.js server.
 * Does not echo the session token; only lengths and backend /me HTTP status.
 */
export async function GET(request: Request) {
  if (process.env.ADMIN_AUTH_DEBUG?.trim() !== "1") {
    return NextResponse.json({ error: "admin_auth_debug_disabled" }, { status: 404, headers: noStore });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value?.trim() ?? "";
  const h = request.headers;

  let backendMeHttpStatus = 0;
  let backendMeErrorSnippet: string | undefined;
  if (token) {
    const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/me`;
    try {
      const res = await fetch(backendURL, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      backendMeHttpStatus = res.status;
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).trim();
        backendMeErrorSnippet = text.slice(0, 240) || undefined;
      }
    } catch (err) {
      backendMeHttpStatus = -1;
      backendMeErrorSnippet = err instanceof Error ? err.message.slice(0, 240) : "fetch_error";
    }
  }

  return NextResponse.json(
    {
      hasAdminSessionCookie: Boolean(token),
      adminSessionCookieValueLength: token.length,
      host: h.get("host") ?? null,
      xForwardedHost: h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? null,
      xForwardedProto: h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null,
      nextKubernetes: Boolean(process.env.KUBERNETES_SERVICE_HOST),
      backendInternalApiBaseUrlSet: Boolean(process.env.BACKEND_INTERNAL_API_BASE_URL?.trim()),
      backendMeHttpStatus,
      backendMeErrorSnippet,
    },
    { headers: noStore },
  );
}

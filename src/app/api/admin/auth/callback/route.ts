import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const adminSessionCookieName = "mac_admin_session";

function resolveBackendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  return (
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase
  );
}

export async function GET(request: Request) {
  const reqURL = new URL(request.url);
  const sessionID = reqURL.searchParams.get("session_id")?.trim();
  if (!sessionID) {
    return NextResponse.redirect(new URL("/admin/login?auth=failed", reqURL.origin));
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/finish?session_id=${encodeURIComponent(sessionID)}`;
  try {
    const response = await fetch(backendURL, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | { sessionToken?: string; expiresAt?: string }
      | null;
    if (!response.ok || !payload?.sessionToken) {
      return NextResponse.redirect(new URL("/admin/login?auth=failed", reqURL.origin));
    }

    const redirectResponse = NextResponse.redirect(new URL("/admin", reqURL.origin));
    const expires = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
    redirectResponse.cookies.set(adminSessionCookieName, payload.sessionToken, {
      httpOnly: true,
      secure: reqURL.protocol === "https:",
      sameSite: "lax",
      path: "/",
      expires,
    });
    return redirectResponse;
  } catch {
    return NextResponse.redirect(new URL("/admin/login?auth=failed", reqURL.origin));
  }
}

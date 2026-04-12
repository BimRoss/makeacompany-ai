import { NextResponse } from "next/server";
import { cookies } from "next/headers";

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

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value ?? "";

  if (token) {
    const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/logout`;
    try {
      await fetch(backendURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
    } catch {
      // Best effort on backend session cleanup.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminSessionCookieName, "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return response;
}

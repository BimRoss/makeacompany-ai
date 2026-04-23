import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const adminSessionCookieName = "mac_admin_session";

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

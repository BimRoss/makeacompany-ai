import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";

  if (token) {
    const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/auth/logout`;
    try {
      await fetch(backendURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
    } catch {
      // Best effort
    }
  }

  const clearOpts = {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(0),
  };
  const response = NextResponse.json({ ok: true });
  response.cookies.set(meSessionCookieName, "", clearOpts);
  return response;
}

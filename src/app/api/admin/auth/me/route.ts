import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const adminSessionCookieName = "mac_admin_session";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value ?? "";

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/me`;
  try {
    const response = await fetch(backendURL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ authenticated: false }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ authenticated: false, error: message }, { status: 502 });
  }
}

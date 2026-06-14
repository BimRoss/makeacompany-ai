import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(meSessionCookieName)?.value ?? "";

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/billing/cancel-subscription`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { portalSessionCookieName } from "@/lib/portal-session-cookies";

export const dynamic = "force-dynamic";

function resolveBackendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  return (
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase
  );
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(portalSessionCookieName)?.value ?? "";

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/me`;
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

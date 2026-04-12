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

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/catalog`;
  try {
    const response = await fetch(backendURL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const payload = await response
      .json()
      .catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `catalog proxy failed: ${message}` }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value ?? "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/catalog`;
  const adminToken = request.headers.get("x-admin-token")?.trim();
  const rawBody = await request.text();

  try {
    const response = await fetch(backendURL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: rawBody,
      cache: "no-store",
    });
    const payload = await response
      .json()
      .catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `catalog proxy failed: ${message}` }, { status: 502 });
  }
}

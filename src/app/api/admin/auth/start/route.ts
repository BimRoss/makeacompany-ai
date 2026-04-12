import { NextResponse } from "next/server";

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

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/auth/start`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        successUrl: `${origin}/api/admin/auth/callback?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/admin/login?auth=cancel`,
      }),
      cache: "no-store",
    });
    const payload = await response
      .json()
      .catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `auth start failed: ${message}` }, { status: 502 });
  }
}

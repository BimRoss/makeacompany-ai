import { NextResponse } from "next/server";

import { portalStripeSigninChannelCookieName } from "@/lib/portal-session-cookies";

export const dynamic = "force-dynamic";

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/$/, "");
  return trimmed.replace(/^0\.0\.0\.0(?=[:/]|$)/, "localhost");
}

function resolvePublicOrigin(request: Request): string {
  const reqURL = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = normalizeHost(request.headers.get("x-forwarded-host")?.split(",")[0] ?? "");
  const host = normalizeHost(request.headers.get("host") ?? "");
  const protocol = forwardedProto || reqURL.protocol.replace(":", "");

  if (forwardedHost) {
    return `${protocol}://${forwardedHost}`;
  }
  if (host) {
    return `${protocol}://${host}`;
  }

  if (reqURL.hostname === "0.0.0.0") {
    const fallbackBase = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_BASE_URL;
    if (fallbackBase) {
      return new URL(fallbackBase).origin;
    }
    return "http://localhost:3000";
  }
  return reqURL.origin;
}

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
  let channelId = "";
  let stripeCustomerId = "";
  try {
    const body = (await request.json()) as { channelId?: string; stripeCustomerId?: string };
    channelId = (body.channelId ?? "").trim();
    stripeCustomerId = (body.stripeCustomerId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!channelId) {
    return NextResponse.json({ error: "missing channelId" }, { status: 400 });
  }

  const origin = resolvePublicOrigin(request);
  const reqURL = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const cookieSecure = (forwardedProto || reqURL.protocol.replace(":", "")) === "https";
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/portal/auth/start`;
  const cancelQS = new URLSearchParams({ auth: "cancel" });
  if (stripeCustomerId) {
    cancelQS.set("stripe_customer", stripeCustomerId);
  }
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId,
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        // Match admin auth: only {CHECKOUT_SESSION_ID} in success_url (Stripe hosted redirect).
        successUrl: `${origin}/api/portal/auth/callback?session_id={CHECKOUT_SESSION_ID}&cid=${encodeURIComponent(channelId)}`,
        cancelUrl: `${origin}/${encodeURIComponent(channelId)}/login?${cancelQS.toString()}`,
      }),
      cache: "no-store",
    });
    const payload = await response
      .json()
      .catch(() => ({ error: "invalid backend response" }));
    const res = NextResponse.json(payload, { status: response.status });
    if (response.ok && payload && typeof payload === "object" && "url" in payload && typeof (payload as { url?: unknown }).url === "string") {
      res.cookies.set(portalStripeSigninChannelCookieName, channelId, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      });
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `portal auth start failed: ${message}` }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { meSessionCookieName } from "@/lib/me-session-cookies";

export const dynamic = "force-dynamic";

const backendURL = () => `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/me/claude-key`;

async function sessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(meSessionCookieName)?.value ?? "";
}

async function forward(method: "GET" | "DELETE", token: string) {
  const response = await fetch(backendURL(), {
    method,
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}

export async function GET() {
  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await forward("GET", token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  try {
    const response = await fetch(backendURL(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE() {
  const token = await sessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await forward("DELETE", token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

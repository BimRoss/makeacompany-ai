import { NextResponse } from "next/server";

import {
  adminProxyNextJson,
  backendProxyAuthHeaders,
  parseBackendProxyBody,
  resolveBackendBaseURL,
} from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const backendPath = "/v1/admin/marketing/campaigns";

async function backendURL(): Promise<string> {
  return `${resolveBackendBaseURL().replace(/\/$/, "")}${backendPath}`;
}

export async function GET() {
  try {
    const response = await fetch(await backendURL(), {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `marketing list proxy failed: ${message}` }, 502);
  }
}

export async function POST(request: Request) {
  let body: string;
  try {
    body = await request.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `body read failed: ${message}` }, 400);
  }

  const authHeaders = await backendProxyAuthHeaders();
  try {
    const response = await fetch(await backendURL(), {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body,
    });
    const payload = await parseBackendProxyBody(response);
    return adminProxyNextJson(payload, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return adminProxyNextJson({ error: `marketing create proxy failed: ${message}` }, 502);
  }
}

// Explicit method-not-allowed for the other verbs so middleware doesn't pass
// them through unnoticed.
export function PUT() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}

export function DELETE() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}

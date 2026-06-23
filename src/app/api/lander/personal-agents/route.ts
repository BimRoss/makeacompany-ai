import { NextResponse } from "next/server";

import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export const dynamic = "force-dynamic";

const backendPath = "/v1/lander/personal-agents";

export async function GET() {
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}${backendPath}`;
  try {
    const response = await fetch(backendURL, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 400) };
      }
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `personal-agents proxy failed: ${message}` }, { status: 502 });
  }
}

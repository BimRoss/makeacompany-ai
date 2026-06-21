import { NextResponse } from "next/server";

import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";

export const dynamic = "force-dynamic";

const backendPath = "/v1/marketing/tier-waitlist";

export async function POST(request: Request) {
  let body: string;
  try {
    body = await request.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `body read failed: ${message}` }, { status: 400 });
  }

  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}${backendPath}`;
  try {
    const response = await fetch(backendURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body,
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
    return NextResponse.json({ error: `waitlist proxy failed: ${message}` }, { status: 502 });
  }
}

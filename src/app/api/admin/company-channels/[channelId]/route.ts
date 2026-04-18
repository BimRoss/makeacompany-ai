import { NextResponse } from "next/server";
import { resolveBackendBaseURL, resolveBackendBearerToken } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  const id = encodeURIComponent((channelId ?? "").trim());
  if (!id) {
    return NextResponse.json({ error: "missing channel id" }, { status: 400 });
  }
  const token = await resolveBackendBearerToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backendURL = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/admin/company-channels/${id}`;
  try {
    const response = await fetch(backendURL, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({ error: "invalid backend response" }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `company-channel proxy failed: ${message}` }, { status: 502 });
  }
}

export async function PATCH() {
  return NextResponse.json(
    { error: "Channel registry editing is disabled from this site. Use internal tooling or GitOps." },
    { status: 403 },
  );
}

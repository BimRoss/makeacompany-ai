import { NextResponse } from "next/server";
import { backendProxyAuthHeaders, parseBackendProxyBody, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = resolveBackendBaseURL().replace(/\/$/, "");
  const runtimeReadToken = process.env.CAPABILITY_CATALOG_READ_TOKEN?.trim();

  if (runtimeReadToken) {
    try {
      const response = await fetch(`${base}/v1/runtime/capability-catalog`, {
        headers: { Authorization: `Bearer ${runtimeReadToken}` },
        cache: "no-store",
      });
      const payload = await parseBackendProxyBody(response);
      if (response.ok) {
        return NextResponse.json(payload, { status: 200 });
      }
    } catch {
      /* fall through to admin catalog */
    }
  }

  const backendURL = `${base}/v1/admin/catalog`;
  try {
    const response = await fetch(backendURL, {
      headers: await backendProxyAuthHeaders(),
      cache: "no-store",
    });
    const payload = await parseBackendProxyBody(response);
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `catalog proxy failed: ${message}` }, { status: 502 });
  }
}

export async function PUT() {
  return NextResponse.json(
    { error: "Catalog editing is disabled. Update capability data in the orchestrator / employee-factory pipeline." },
    { status: 403 },
  );
}

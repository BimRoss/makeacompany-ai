import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { hasValidAdminApiSession, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";
import { buildGrafanaHealthEmbeds } from "@/lib/grafana-embeds-build";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";

  const grafana = buildGrafanaHealthEmbeds(host, proto);
  const checkedAt = new Date().toISOString();

  const adminOk = await hasValidAdminApiSession();
  if (!adminOk) {
    return NextResponse.json(
      {
        status: "degraded" as const,
        error: "Sign in to the admin to load backend health, indexer, and request metadata.",
        checkedAt,
        ...grafana,
        recentRequests: [] as unknown[],
      },
      { status: 200 }
    );
  }

  const backendBase = resolveBackendBaseURL();
  const backendHealthURL = `${backendBase.replace(/\/$/, "")}/health`;
  const backendIndexerRequestsURL = `${backendBase.replace(/\/$/, "")}/api/internal/indexer-recent-requests?limit=100&offset=0`;

  try {
    const [response, recentRequestsResponse] = await Promise.all([
      fetch(backendHealthURL, { cache: "no-store" }),
      fetch(backendIndexerRequestsURL, { cache: "no-store" }),
    ]);
    const payload = await response.json().catch(() => ({
      status: "degraded",
      error: "invalid backend health response",
    }));
    const recentRequestsPayload = await recentRequestsResponse
      .json()
      .catch(() => ({ status: "degraded", requests: [] }));
    const recentRequests = Array.isArray(recentRequestsPayload?.requests)
      ? recentRequestsPayload.requests
      : [];

    return NextResponse.json(
      {
        ...payload,
        recentRequests,
        checkedAt,
        backendHealthURL,
        backendIndexerRequestsURL,
        ...grafana,
      },
      { status: response.ok ? 200 : 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        status: "degraded",
        error: `health proxy failed: ${message}`,
        checkedAt,
        backendHealthURL,
        backendIndexerRequestsURL,
        ...grafana,
        recentRequests: [] as unknown[],
      },
      { status: 502 }
    );
  }
}

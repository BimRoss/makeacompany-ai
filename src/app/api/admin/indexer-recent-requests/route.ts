import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 5_000_000;
const DEFAULT_OFFSET = 0;

export async function GET(request: Request) {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  const backendBase =
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase;

  const incomingUrl = new URL(request.url);
  const requestedLimit = Number.parseInt(incomingUrl.searchParams.get("limit") ?? "", 10);
  const requestedOffset = Number.parseInt(incomingUrl.searchParams.get("offset") ?? "", 10);
  const safeLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
  const safeOffset =
    Number.isFinite(requestedOffset) && requestedOffset >= 0
      ? Math.min(requestedOffset, MAX_LIMIT)
      : DEFAULT_OFFSET;

  const backendBaseURL = backendBase.replace(/\/$/, "");
  const url = `${backendBaseURL}/api/internal/indexer-recent-requests?limit=${safeLimit}&offset=${safeOffset}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response
      .json()
      .catch(() => ({ status: "degraded", error: "invalid backend response", requests: [] }));
    return NextResponse.json(payload, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        status: "degraded",
        error: `indexer recent requests proxy failed: ${message}`,
        requests: [],
      },
      { status: 502 }
    );
  }
}

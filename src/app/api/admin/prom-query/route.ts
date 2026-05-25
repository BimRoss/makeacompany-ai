import { NextResponse } from "next/server";

import { adminProxyNextJson, requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

/**
 * Instant PromQL proxy for the /admin KPI scorecard.
 * Accepts up to 16 queries per request as `?q=<promql>&q=<promql>&...` (no `time=` —
 * Prometheus uses "now"). Returns `{ results: [{ query, value, error }] }`.
 *
 * Per-request fanout keeps the round-trip count down vs. one fetch per tile and
 * lets the scorecard pulse on a single timer.
 */
export async function GET(request: Request) {
  const guard = await requireAdminApiSession();
  if (guard) return guard;

  const promBase = (process.env.HEALTH_PROMETHEUS_QUERY_URL ?? "").trim().replace(/\/$/, "");
  if (!promBase) {
    return adminProxyNextJson(
      { error: "HEALTH_PROMETHEUS_QUERY_URL is not configured" },
      503
    );
  }

  const url = new URL(request.url);
  const queries = url.searchParams.getAll("q").map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) {
    return adminProxyNextJson({ error: "missing q parameter" }, 400);
  }
  if (queries.length > 16) {
    return adminProxyNextJson({ error: "max 16 queries per request" }, 400);
  }

  const results = await Promise.all(
    queries.map(async (query) => {
      const promURL = new URL(`${promBase}/api/v1/query`);
      promURL.searchParams.set("query", query);
      try {
        const response = await fetch(promURL.toString(), {
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) {
          return { query, value: null, error: `prom http ${response.status}` };
        }
        const payload = (await response.json()) as {
          status?: string;
          data?: { resultType?: string; result?: Array<{ value?: [number, string] }> };
        };
        if (payload.status !== "success") {
          return { query, value: null, error: "prom non-success" };
        }
        const first = payload.data?.result?.[0]?.value?.[1];
        if (first === undefined) {
          return { query, value: null, error: null };
        }
        const numeric = Number(first);
        return {
          query,
          value: Number.isFinite(numeric) ? numeric : null,
          error: Number.isFinite(numeric) ? null : "non-numeric",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "fetch failed";
        return { query, value: null, error: message };
      }
    })
  );

  return NextResponse.json(
    { results, fetchedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

import { NextResponse } from "next/server";

import { adminProxyNextJson, requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

/**
 * Range PromQL proxy for the native /admin observability charts.
 *
 * Accepts up to 8 queries per request as `?q=<promql>&q=<promql>&...`, a
 * Grafana-style relative window `?from=now-6h` (defaults to now-6h), and an
 * optional `?step=<seconds>`. Resolves the relative window to absolute unix
 * timestamps here (Prometheus query_range only takes absolute start/end) and
 * picks a step that keeps each series at ~240 points unless one is supplied.
 *
 * Returns `{ series: [{ query, points: [[tsSeconds, value], ...], labels, error }] }`.
 * One series per (query × metric label-set) so multi-line panels (status class,
 * latency percentiles) resolve from a single fanned-out request.
 */

const MAX_QUERIES = 8;
const TARGET_POINTS = 240;

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

function parseRelativeWindowSeconds(from: string): number {
  // "now-6h" → 21600. Falls back to 6h for anything unrecognized.
  const match = /^now-(\d+)([smhdw])$/.exec(from.trim());
  if (!match) return 6 * 3600;
  const amount = Number(match[1]);
  const unit = UNIT_SECONDS[match[2]] ?? 3600;
  const seconds = amount * unit;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 6 * 3600;
}

type PromRangeResult = {
  metric?: Record<string, string>;
  values?: Array<[number, string]>;
};

type Series = {
  query: string;
  labels: Record<string, string>;
  points: Array<[number, number]>;
  error: string | null;
};

export async function GET(request: Request) {
  const guard = await requireAdminApiSession();
  if (guard) return guard;

  const promBase = (process.env.HEALTH_PROMETHEUS_QUERY_URL ?? "").trim().replace(/\/$/, "");
  if (!promBase) {
    return adminProxyNextJson({ error: "HEALTH_PROMETHEUS_QUERY_URL is not configured" }, 503);
  }

  const url = new URL(request.url);
  const queries = url.searchParams.getAll("q").map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) {
    return adminProxyNextJson({ error: "missing q parameter" }, 400);
  }
  if (queries.length > MAX_QUERIES) {
    return adminProxyNextJson({ error: `max ${MAX_QUERIES} queries per request` }, 400);
  }

  const windowSeconds = parseRelativeWindowSeconds(url.searchParams.get("from") ?? "now-6h");
  const end = Math.floor(Date.now() / 1000);
  const start = end - windowSeconds;

  const requestedStep = Number(url.searchParams.get("step"));
  const step =
    Number.isFinite(requestedStep) && requestedStep >= 1
      ? Math.floor(requestedStep)
      : Math.max(15, Math.floor(windowSeconds / TARGET_POINTS));

  const series = (
    await Promise.all(
      queries.map(async (query): Promise<Series[]> => {
        const promURL = new URL(`${promBase}/api/v1/query_range`);
        promURL.searchParams.set("query", query);
        promURL.searchParams.set("start", String(start));
        promURL.searchParams.set("end", String(end));
        promURL.searchParams.set("step", String(step));
        try {
          const response = await fetch(promURL.toString(), {
            cache: "no-store",
            signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) {
            return [{ query, labels: {}, points: [], error: `prom http ${response.status}` }];
          }
          const payload = (await response.json()) as {
            status?: string;
            data?: { result?: PromRangeResult[] };
          };
          if (payload.status !== "success") {
            return [{ query, labels: {}, points: [], error: "prom non-success" }];
          }
          const result = payload.data?.result ?? [];
          if (result.length === 0) {
            return [{ query, labels: {}, points: [], error: null }];
          }
          return result.map((r) => ({
            query,
            labels: r.metric ?? {},
            points: (r.values ?? [])
              .map(([ts, v]): [number, number] => [ts, Number(v)])
              .filter(([, v]) => Number.isFinite(v)),
            error: null,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "fetch failed";
          return [{ query, labels: {}, points: [], error: message }];
        }
      })
    )
  ).flat();

  return NextResponse.json(
    { series, start, end, step, fetchedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

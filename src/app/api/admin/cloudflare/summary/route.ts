import { NextResponse } from "next/server";

import { adminProxyNextJson, requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

function parseRelativeWindowSeconds(from: string): number {
  const match = /^now-(\d+)([smhdw])$/.exec(from.trim());
  if (!match) return 24 * 3600;
  const amount = Number(match[1]);
  const unit = UNIT_SECONDS[match[2]] ?? 3600;
  const seconds = amount * unit;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 24 * 3600;
}

/**
 * Cloudflare's GraphQL API exposes two relevant aggregators:
 *  - httpRequests1mGroups: 1-minute buckets, but only available for the last 24h.
 *  - httpRequests1hGroups: 1-hour buckets, retained for ~7 days.
 * Pick the finer one for short windows and fall back to hourly for >24h.
 */
function pickBucket(windowSeconds: number): { groups: "min" | "hour"; bucketSeconds: number; limit: number } {
  if (windowSeconds <= 24 * 3600) {
    const limit = Math.min(1440, Math.max(2, Math.ceil(windowSeconds / 60) + 5));
    return { groups: "min", bucketSeconds: 60, limit };
  }
  const limit = Math.min(168, Math.max(2, Math.ceil(windowSeconds / 3600) + 1));
  return { groups: "hour", bucketSeconds: 3600, limit };
}

function buildQuery(groups: "min" | "hour"): string {
  const groupName = groups === "min" ? "httpRequests1mGroups" : "httpRequests1hGroups";
  return `
query Zone($zoneTag: String!, $start: Time!, $end: Time!, $limit: Int!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      buckets: ${groupName}(
        limit: $limit
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [datetime_ASC]
      ) {
        dimensions { datetime }
        sum {
          bytes
          cachedBytes
          cachedRequests
          requests
          responseStatusMap { edgeResponseStatus requests }
        }
      }
      countryGroups: httpRequestsAdaptiveGroups(
        limit: 8
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [sum_requests_DESC]
      ) {
        dimensions { clientCountryName }
        sum { requests }
      }
      firewallByAction: firewallEventsAdaptiveGroups(
        limit: 8
        filter: { datetime_geq: $start, datetime_leq: $end }
        orderBy: [count_DESC]
      ) {
        dimensions { action }
        count
      }
    }
  }
}`;
}

type StatusMap = { edgeResponseStatus: number; requests: number };

type Bucket = {
  dimensions: { datetime: string };
  sum: {
    bytes: number;
    cachedBytes: number;
    cachedRequests: number;
    requests: number;
    responseStatusMap: StatusMap[];
  };
};

type Point = [number, number];

function bucketSeconds(b: Bucket): number {
  return Math.floor(new Date(b.dimensions.datetime).getTime() / 1000);
}

function statusClassRequests(b: Bucket, prefix: "2" | "3" | "4" | "5"): number {
  return b.sum.responseStatusMap
    .filter((s) => String(s.edgeResponseStatus).startsWith(prefix))
    .reduce((acc, s) => acc + s.requests, 0);
}

export async function GET(request: Request) {
  const guard = await requireAdminApiSession();
  if (guard) return guard;

  const token = (process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? "").trim();
  const zoneTag = (process.env.CLOUDFLARE_ZONE_ID_MAKEACOMPANY_AI ?? "").trim();
  if (!token || !zoneTag) {
    return adminProxyNextJson(
      { error: "Cloudflare analytics not configured (set CLOUDFLARE_ANALYTICS_TOKEN + CLOUDFLARE_ZONE_ID_MAKEACOMPANY_AI)" },
      503,
    );
  }

  const url = new URL(request.url);
  const windowSeconds = parseRelativeWindowSeconds(url.searchParams.get("from") ?? "now-24h");
  const bucket = pickBucket(windowSeconds);
  const end = new Date();
  const start = new Date(end.getTime() - windowSeconds * 1000);

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: buildQuery(bucket.groups),
        variables: {
          zoneTag,
          start: start.toISOString(),
          end: end.toISOString(),
          limit: bucket.limit,
        },
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return adminProxyNextJson({ error: `cloudflare fetch failed: ${message}` }, 502);
  }

  if (!response.ok) {
    return adminProxyNextJson({ error: `cloudflare http ${response.status}` }, 502);
  }

  const payload = (await response.json()) as {
    errors?: Array<{ message?: string }>;
    data?: {
      viewer?: {
        zones?: Array<{
          buckets?: Bucket[];
          countryGroups?: Array<{
            dimensions: { clientCountryName: string };
            sum: { requests: number };
          }>;
          firewallByAction?: Array<{
            dimensions: { action: string };
            count: number;
          }>;
        }>;
      };
    };
  };

  if (payload.errors?.length) {
    return adminProxyNextJson(
      { error: `cloudflare graphql: ${payload.errors[0]?.message ?? "unknown"}` },
      502,
    );
  }

  const zone = payload.data?.viewer?.zones?.[0];
  const buckets = zone?.buckets ?? [];
  const topCountries = (zone?.countryGroups ?? []).map((g) => ({
    country: g.dimensions.clientCountryName || "Unknown",
    requests: g.sum.requests,
  }));
  const firewallEvents = (zone?.firewallByAction ?? []).map((g) => ({
    action: g.dimensions.action || "unknown",
    count: g.count,
  }));
  const firewallTotal = firewallEvents.reduce((acc, e) => acc + e.count, 0);

  const requestsPerMin: Point[] = [];
  const bandwidthBps: Point[] = [];
  const cacheHitRatio: Point[] = [];
  const reqs2xx: Point[] = [];
  const reqs4xx: Point[] = [];
  const reqs5xx: Point[] = [];
  let totalRequests = 0;
  let totalCachedRequests = 0;

  // Convert bucket totals to per-second / per-minute averages so the chart
  // axes are stable regardless of bucket size (1m vs 1h).
  const perMinDiv = bucket.bucketSeconds / 60;
  const bpsDiv = bucket.bucketSeconds;
  for (const b of buckets) {
    totalRequests += b.sum.requests;
    totalCachedRequests += b.sum.cachedRequests;
    const ts = bucketSeconds(b);
    requestsPerMin.push([ts, b.sum.requests / perMinDiv]);
    bandwidthBps.push([ts, b.sum.bytes / bpsDiv]);
    cacheHitRatio.push([
      ts,
      b.sum.requests > 0 ? b.sum.cachedRequests / b.sum.requests : 0,
    ]);
    reqs2xx.push([ts, statusClassRequests(b, "2") / perMinDiv]);
    reqs4xx.push([ts, statusClassRequests(b, "4") / perMinDiv]);
    reqs5xx.push([ts, statusClassRequests(b, "5") / perMinDiv]);
  }

  return NextResponse.json(
    {
      asOf: new Date().toISOString(),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      zoneTag,
      summary: {
        totalRequests,
        cacheHitRatio24h: totalRequests > 0 ? totalCachedRequests / totalRequests : 0,
        firewallEventsTotal: firewallTotal,
      },
      panels: {
        requestsPerMin,
        bandwidthBps,
        cacheHitRatio,
        statusClass: { reqs2xx, reqs4xx, reqs5xx },
      },
      topCountries,
      firewallEvents,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}

import { NextResponse } from "next/server";

import { adminProxyNextJson, requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

const CLOUDFLARE_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

const QUERY = `
query Zone($zoneTag: String!, $start: Time!, $end: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1hGroups(
        limit: 168
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
    }
  }
}`;

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

export async function GET() {
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

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

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
        query: QUERY,
        variables: {
          zoneTag,
          start: start.toISOString(),
          end: end.toISOString(),
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
    data?: { viewer?: { zones?: Array<{ httpRequests1hGroups?: Bucket[] }> } };
  };

  if (payload.errors?.length) {
    return adminProxyNextJson(
      { error: `cloudflare graphql: ${payload.errors[0]?.message ?? "unknown"}` },
      502,
    );
  }

  const buckets = payload.data?.viewer?.zones?.[0]?.httpRequests1hGroups ?? [];

  const requestsPerMin: Point[] = [];
  const bandwidthBps: Point[] = [];
  const cacheHitRatio: Point[] = [];
  const reqs2xx: Point[] = [];
  const reqs4xx: Point[] = [];
  const reqs5xx: Point[] = [];

  for (const b of buckets) {
    const ts = bucketSeconds(b);
    requestsPerMin.push([ts, b.sum.requests / 60]);
    bandwidthBps.push([ts, b.sum.bytes / 3600]);
    cacheHitRatio.push([
      ts,
      b.sum.requests > 0 ? b.sum.cachedRequests / b.sum.requests : 0,
    ]);
    reqs2xx.push([ts, statusClassRequests(b, "2") / 60]);
    reqs4xx.push([ts, statusClassRequests(b, "4") / 60]);
    reqs5xx.push([ts, statusClassRequests(b, "5") / 60]);
  }

  return NextResponse.json(
    {
      asOf: new Date().toISOString(),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      zoneTag,
      panels: {
        requestsPerMin,
        bandwidthBps,
        cacheHitRatio,
        statusClass: { reqs2xx, reqs4xx, reqs5xx },
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
}

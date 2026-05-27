import { NextResponse } from "next/server";

import { requireAdminApiSession, resolveBackendBaseURL } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

type CheckResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
};

const PROBE_TIMEOUT_MS = 3500;

/**
 * Synthetic probe stub for the admin "golden path" KPI.
 *
 * Hits a handful of internal endpoints in parallel and reports a single
 * `{ ok, checks[] }`. Cheap, in-process — the real win is a separate cron
 * that exercises the full user-visible flow (login → snapshot → render)
 * and writes a `synthetic_ok` gauge to Prometheus so alerts can page on it.
 * This route is what the dashboard polls in the meantime.
 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if (guard) return guard;

  const backendBase = resolveBackendBaseURL().replace(/\/$/, "");
  const origin = process.env.NEXTAUTH_URL?.trim() || "http://127.0.0.1:3000";

  const targets: { name: string; url: string }[] = [
    { name: "backend-health", url: `${backendBase}/health` },
    { name: "prom-query-reachable", url: `${origin}/api/admin/prom-query?q=vector(1)` },
    { name: "prom-alerts-reachable", url: `${origin}/api/admin/prom-alerts` },
  ];

  const checks = await Promise.all(
    targets.map(async ({ name, url }): Promise<CheckResult> => {
      const started = Date.now();
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return {
          name,
          ok: response.ok,
          latencyMs: Date.now() - started,
          error: response.ok ? null : `http ${response.status}`,
        };
      } catch (error) {
        return {
          name,
          ok: false,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : "fetch failed",
        };
      }
    })
  );

  const ok = checks.every((c) => c.ok);
  return NextResponse.json(
    { ok, checks, checkedAt: new Date().toISOString() },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

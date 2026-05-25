import { NextResponse } from "next/server";

import { adminProxyNextJson, requireAdminApiSession } from "@/lib/backend-proxy-auth";

export const dynamic = "force-dynamic";

export type AdminAlert = {
  name: string;
  state: "firing" | "pending" | "inactive";
  severity: string;
  component: string;
  summary: string;
  description: string;
  activeAt: string | null;
  /** Free-form Prometheus alert labels (used for matching to UI panels). */
  labels: Record<string, string>;
};

type PrometheusAlert = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state?: string;
  activeAt?: string;
};

/**
 * Returns the alerts Prometheus is currently tracking, filtered to
 * `labels.surface == "admin"` so we don't surface unrelated rules from
 * other dashboards on /admin.
 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if (guard) return guard;

  const promBase = (process.env.HEALTH_PROMETHEUS_QUERY_URL ?? "").trim().replace(/\/$/, "");
  if (!promBase) {
    return adminProxyNextJson(
      { error: "HEALTH_PROMETHEUS_QUERY_URL is not configured", alerts: [] },
      200
    );
  }

  try {
    const response = await fetch(`${promBase}/api/v1/alerts`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      return adminProxyNextJson(
        { error: `prom http ${response.status}`, alerts: [] },
        200
      );
    }
    const payload = (await response.json()) as {
      status?: string;
      data?: { alerts?: PrometheusAlert[] };
    };
    if (payload.status !== "success") {
      return adminProxyNextJson({ error: "prom non-success", alerts: [] }, 200);
    }

    const alerts: AdminAlert[] = (payload.data?.alerts ?? [])
      .filter((alert) => alert.labels?.surface === "admin")
      .map((alert) => {
        const labels = alert.labels ?? {};
        const annotations = alert.annotations ?? {};
        const state =
          alert.state === "firing" || alert.state === "pending"
            ? alert.state
            : "inactive";
        return {
          name: labels.alertname ?? "unknown",
          state,
          severity: labels.severity ?? "info",
          component: labels.component ?? "",
          summary: annotations.summary ?? labels.alertname ?? "unknown",
          description: annotations.description ?? "",
          activeAt: alert.activeAt ?? null,
          labels,
        };
      });

    // firing > pending > inactive; within a tier, critical > warning > info
    const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const stateRank: Record<string, number> = { firing: 0, pending: 1, inactive: 2 };
    alerts.sort((a, b) => {
      const sd = (stateRank[a.state] ?? 9) - (stateRank[b.state] ?? 9);
      if (sd !== 0) return sd;
      return (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    });

    return NextResponse.json(
      { alerts, fetchedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return adminProxyNextJson({ error: message, alerts: [] }, 200);
  }
}

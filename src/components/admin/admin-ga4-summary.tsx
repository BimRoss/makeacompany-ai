"use client";

import { useEffect, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

type GA4SummaryPayload = {
  status?: "ok" | "disabled" | "degraded";
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  activeUsers?: number;
  sessions?: number;
  fetchedAt?: string;
  error?: string;
};

function formatNumber(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function AdminGa4Summary() {
  const [payload, setPayload] = useState<GA4SummaryPayload | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/ga4-summary", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) {
          return;
        }
        const json = (await response.json()) as GA4SummaryPayload;
        if (!cancelled) setPayload(json);
      } catch (error) {
        if (!cancelled) {
          setPayload({
            status: "degraded",
            error: error instanceof Error ? error.message : "ga4-summary fetch failed",
          });
        }
      } finally {
        if (!cancelled) setFetched(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!fetched) {
    return (
      <section className="rounded-none bg-card px-0 pb-3 pt-3 sm:rounded-2xl sm:pb-4 sm:pt-4">
        <div className="flex min-h-[5rem] items-center justify-center rounded-none border border-dashed border-border bg-background/40 px-4 py-6 text-center sm:rounded-xl">
          <p className="text-sm text-muted-foreground">Loading GA4 summary…</p>
        </div>
      </section>
    );
  }

  if (payload?.status === "disabled") {
    return null;
  }

  return (
    <section className="rounded-none bg-card px-0 pb-3 pt-3 sm:rounded-2xl sm:pb-4 sm:pt-4">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:gap-2">
        <Ga4MetricCard label="Active users · 7d" value={formatNumber(payload?.activeUsers)} />
        <Ga4MetricCard label="Sessions · 7d" value={formatNumber(payload?.sessions)} />
      </div>
      {payload?.status === "degraded" ? (
        <p className="mt-2 px-1 text-xs text-muted-foreground">GA4: {payload?.error ?? "fetch failed"}</p>
      ) : null}
    </section>
  );
}

function Ga4MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="overflow-hidden rounded-none border border-border bg-background/60 px-4 py-4 sm:rounded-xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </article>
  );
}

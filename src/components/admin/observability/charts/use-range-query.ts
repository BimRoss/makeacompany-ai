"use client";

import { useEffect, useRef, useState } from "react";

import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

export type RangeSeries = {
  query: string;
  labels: Record<string, string>;
  points: Array<[number, number]>;
  error: string | null;
};

type RangePayload = { series?: RangeSeries[] };

const POLL_INTERVAL_MS = 30_000;

/**
 * Fetches one or more PromQL range queries from /api/admin/prom-range for the
 * given relative window, polling every 30s. Returns every metric label-set as a
 * flat series list so multi-line panels can split on a chosen label.
 */
export function useRangeQuery(queries: string[], from: string) {
  const [series, setSeries] = useState<RangeSeries[] | null>(null);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);
  const key = `${from}::${queries.join("|")}`;

  useEffect(() => {
    cancelledRef.current = false;
    if (queries.length === 0) {
      setSeries([]);
      return;
    }

    const load = async () => {
      try {
        const url = new URL("/api/admin/prom-range", window.location.origin);
        url.searchParams.set("from", from);
        for (const q of queries) url.searchParams.append("q", q);
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) return;
        if (!response.ok) {
          if (!cancelledRef.current) setErrored(true);
          return;
        }
        const payload = (await response.json()) as RangePayload;
        if (cancelledRef.current) return;
        setSeries(Array.isArray(payload.series) ? payload.series : []);
        setErrored(false);
      } catch {
        if (!cancelledRef.current) setErrored(true);
      }
    };

    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { series, loading: series === null, errored };
}

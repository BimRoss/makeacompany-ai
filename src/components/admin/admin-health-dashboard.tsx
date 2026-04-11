"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

type HealthStatus = "ok" | "degraded" | "unknown";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
  source?: "twitter" | "app";
};

type HealthPayload = {
  status: HealthStatus;
  checkedAt?: string;
  error?: string;
  grafanaEmbeds?: GrafanaEmbed[];
  recentRequests?: IndexerRecentRequest[];
  cookies?: {
    status: HealthStatus;
    lastRunAt?: string;
    ageMinutes?: number;
    successCount?: number;
    failCount?: number;
    totalCount?: number;
    error?: string;
    authTokenExpiresAt?: string;
  };
  indexer?: {
    status: HealthStatus;
    ready?: boolean;
    workerCount?: number;
    activeJobs?: number;
    receivedJobs?: number;
    totalJobsAccepted?: number;
    jobsLastHour?: number;
    jobsPerMinute?: number;
    errorRate?: number;
    p95JobDurationMs?: number;
    telemetryStatus?: HealthStatus;
    telemetryError?: string;
    error?: string;
  };
  workers?: {
    status: HealthStatus;
    readyCount?: number;
    totalCount?: number;
    jobsLastHour?: number;
    inFlight?: number;
    requestsPerMinute?: number;
    outcomeOkPerMinute?: number;
    outcomeErrPerMinute?: number;
    outcomeRateLimitedPerMinute?: number;
    p95LatencyMs?: number;
    lastTelemetryAt?: string;
    rateLimitedAccounts?: number;
    rateLimitedApiKeys?: number;
    telemetryStatus?: HealthStatus;
    telemetryError?: string;
    instances?: Array<{
      name: string;
      status: HealthStatus;
      ready?: boolean;
      jobsLastHour?: number;
      readinessLatencyMs?: number;
      inFlight?: number;
      requestsPerMinute?: number;
      outcomeOkPerMinute?: number;
      outcomeErrPerMinute?: number;
      outcomeRateLimitedPerMinute?: number;
      p95LatencyMs?: number;
      lastTelemetryAt?: string;
      rateLimitedAccounts?: number;
      rateLimitedApiKeys?: number;
      telemetryError?: string;
      error?: string;
    }>;
  };
};

type IndexerRecentRequest = {
  accepted_at?: string;
  request_id?: string;
  job_id?: string;
  capability?: string;
  query_summary?: string;
  max_results?: number;
  count?: number;
  has_cursor?: boolean;
};

type IndexerRecentRequestsPayload = {
  status: HealthStatus;
  offset?: number;
  limit?: number;
  returned?: number;
  requests?: IndexerRecentRequest[];
  error?: string;
};

type ParsedQuerySummary = {
  maxResults?: number;
  query?: string;
};

const RECENT_REQUESTS_PAGE_SIZE = 100;
const RECENT_REQUESTS_SCROLL_THRESHOLD_PX = 80;

function asGrafanaEmbedUrl(
  value?: string | null,
  panelId: string = "1",
  grafanaTheme: "light" | "dark" = "light"
): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/grafana/d/")) {
      url.pathname = url.pathname.replace(/^\/grafana\/d\//, "/grafana/d-solo/");
    } else if (url.pathname.startsWith("/d/")) {
      url.pathname = url.pathname.replace(/^\/d\//, "/d-solo/");
    }
    url.searchParams.set("orgId", url.searchParams.get("orgId") ?? "1");
    url.searchParams.set("theme", grafanaTheme);
    url.searchParams.set("from", "now-6h");
    url.searchParams.set("to", "now");
    url.searchParams.set("refresh", "30s");
    url.searchParams.set("panelId", panelId);
    url.searchParams.set("kiosk", "1");
    return url.toString();
  } catch {
    return null;
  }
}

function formatNumber(value?: number, digits: number = 0): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatPercent(value?: number, digits: number = 1): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

function formatClockTime(value?: string): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString([], { hour12: false });
}

function truncateValue(value: string | undefined, max: number): string {
  if (!value) {
    return "—";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}...`;
}

function formatAuthExpiry(value?: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (diffMinutes <= 0) {
    return "auth expired";
  }
  if (diffMinutes > 14 * 24 * 60) {
    return null;
  }
  if (diffMinutes >= 24 * 60) {
    return `auth ${Math.round(diffMinutes / (24 * 60))}d`;
  }
  if (diffMinutes >= 60) {
    return `auth ${Math.round(diffMinutes / 60)}h`;
  }
  return `auth ${diffMinutes}m`;
}

function parseQuerySummary(value?: string): ParsedQuerySummary {
  if (!value) {
    return {};
  }
  const maxResultsMatch = value.match(/(?:^|\s)max_results=(\d+)/);
  const queryMatch = value.match(/(?:^|\s)query=(.+)$/);
  return {
    maxResults: maxResultsMatch ? Number(maxResultsMatch[1]) : undefined,
    query: queryMatch?.[1]?.trim(),
  };
}

export function AdminHealthDashboard() {
  const { resolvedTheme } = useTheme();
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentRequests, setRecentRequests] = useState<IndexerRecentRequest[]>([]);
  const [recentRequestsLoading, setRecentRequestsLoading] = useState(true);
  const [recentRequestsLoadingMore, setRecentRequestsLoadingMore] = useState(false);
  const [recentRequestsOffset, setRecentRequestsOffset] = useState(0);
  const [recentRequestsHasMore, setRecentRequestsHasMore] = useState(true);
  const [recentRequestsError, setRecentRequestsError] = useState<string | null>(null);
  const recentRequestsScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        const data = (await response.json()) as HealthPayload;
        if (!cancelled) {
          setPayload(data);
          if (Array.isArray(data.recentRequests)) {
            setRecentRequests(data.recentRequests);
            setRecentRequestsOffset(data.recentRequests.length);
            setRecentRequestsHasMore(data.recentRequests.length === RECENT_REQUESTS_PAGE_SIZE);
            setRecentRequestsError(null);
            setRecentRequestsLoading(false);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPayload({
            status: "degraded",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    const intervalId = setInterval(() => {
      void load();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const fetchRecentRequestsPage = useCallback(async (offset: number, append: boolean) => {
    if (append) {
      setRecentRequestsLoadingMore(true);
    } else {
      setRecentRequestsLoading(true);
    }
    try {
      const response = await fetch(
        `/api/admin/indexer-recent-requests?limit=${RECENT_REQUESTS_PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as IndexerRecentRequestsPayload;
      if (!response.ok || data.status === "degraded") {
        const message = data.error ?? "failed to load indexer request logs";
        if (!append) {
          setRecentRequests([]);
          setRecentRequestsOffset(0);
          setRecentRequestsHasMore(false);
        }
        setRecentRequestsError(message);
        return;
      }
      const rows = data.requests ?? [];
      setRecentRequests((prev) => (append ? [...prev, ...rows] : rows));
      setRecentRequestsOffset(offset + rows.length);
      setRecentRequestsHasMore(rows.length === RECENT_REQUESTS_PAGE_SIZE);
      setRecentRequestsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (!append) {
        setRecentRequests([]);
        setRecentRequestsOffset(0);
        setRecentRequestsHasMore(false);
      }
      setRecentRequestsError(message);
    } finally {
      if (append) {
        setRecentRequestsLoadingMore(false);
      } else {
        setRecentRequestsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (recentRequests.length === 0 && !recentRequestsLoading) {
      void fetchRecentRequestsPage(0, false);
    }
  }, [fetchRecentRequestsPage, recentRequests.length, recentRequestsLoading]);

  useEffect(() => {
    const container = recentRequestsScrollRef.current;
    if (!container) {
      return;
    }
    const onScroll = () => {
      if (recentRequestsLoading || recentRequestsLoadingMore || !recentRequestsHasMore) {
        return;
      }
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceToBottom <= RECENT_REQUESTS_SCROLL_THRESHOLD_PX) {
        void fetchRecentRequestsPage(recentRequestsOffset, true);
      }
    };
    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [
    fetchRecentRequestsPage,
    recentRequestsHasMore,
    recentRequestsLoading,
    recentRequestsLoadingMore,
    recentRequestsOffset,
  ]);

  const cookies = payload?.cookies;
  const indexer = payload?.indexer;
  const workers = payload?.workers;
  const cookieSuccess = cookies?.successCount ?? 0;
  const cookieFail = cookies?.failCount ?? 0;
  const workersReadyValue =
    workers?.readyCount === undefined || workers?.totalCount === undefined
      ? "—"
      : `${workers.readyCount}/${workers.totalCount}`;
  const accountMetaParts = [
    loading ? "..." : cookies?.ageMinutes !== undefined ? `${cookies.ageMinutes}m old` : "—",
    loading ? null : formatAuthExpiry(cookies?.authTokenExpiresAt),
  ].filter(Boolean);
  const errorRateColor =
    indexer?.errorRate === undefined
      ? "text-foreground"
      : indexer.errorRate >= 5
        ? "text-red-500"
        : indexer.errorRate >= 1
          ? "text-amber-500"
          : "text-emerald-500";

  const embedCards = useMemo(
    () =>
      (payload?.grafanaEmbeds ?? [])
        .map((embed) => ({
          ...embed,
          url: asGrafanaEmbedUrl(
            embed.dashboardUrl,
            embed.panelId,
            resolvedTheme === "dark" ? "dark" : "light"
          ),
        }))
        .filter((embed): embed is GrafanaEmbed & { url: string } => typeof embed.url === "string"),
    [payload?.grafanaEmbeds, resolvedTheme]
  );

  return (
    <section className="space-y-3">
      <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">account</h2>
          <div className="mt-1 flex items-end gap-2">
            <strong className="text-3xl leading-none text-emerald-500">{loading ? "—" : cookieSuccess}</strong>
            <span className="text-muted-foreground">|</span>
            <strong className="text-3xl leading-none text-amber-500">{loading ? "—" : cookieFail}</strong>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{accountMetaParts.join(" · ")}</p>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">jobs (1h)</h2>
          <strong className="mt-1 block text-3xl leading-none">{loading ? "—" : formatNumber(indexer?.jobsLastHour)}</strong>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">total jobs</h2>
          <strong className="mt-1 block text-3xl leading-none">
            {loading ? "—" : formatNumber(indexer?.totalJobsAccepted)}
          </strong>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">indexer rpm</h2>
          <strong className="mt-1 block text-3xl leading-none">{loading ? "—" : formatNumber(indexer?.jobsPerMinute, 1)}</strong>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">err %</h2>
          <strong className={`mt-1 block text-3xl leading-none ${errorRateColor}`}>
            {loading ? "—" : formatPercent(indexer?.errorRate)}
          </strong>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">workers</h2>
          <strong className="mt-1 block text-3xl leading-none">{loading ? "—" : workersReadyValue}</strong>
          <p className="mt-1 text-xs text-muted-foreground">ready / total</p>
        </article>

        <article className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">worker rpm</h2>
          <strong className="mt-1 block text-3xl leading-none">
            {loading ? "—" : formatNumber(workers?.requestsPerMinute, 1)}
          </strong>
        </article>
      </nav>

      {!loading && indexer?.telemetryStatus === "degraded" ? (
        <p className="text-xs text-amber-500">indexer telemetry degraded: {indexer.telemetryError ?? "query failures"}</p>
      ) : null}
      {!loading && workers?.telemetryStatus === "degraded" ? (
        <p className="text-xs text-amber-500">worker telemetry degraded: {workers.telemetryError ?? "query failures"}</p>
      ) : null}
      {!loading && payload?.error ? <p className="text-xs text-amber-500">health proxy error: {payload.error}</p> : null}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <section ref={recentRequestsScrollRef} className="max-h-[42vh] min-h-[260px] overflow-auto rounded-xl border border-border bg-card">
          {recentRequestsError ? (
            <div className="px-3 py-2 text-xs text-amber-500">failed to load recent requests: {recentRequestsError}</div>
          ) : null}
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <caption className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              requests
            </caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">time</th>
                <th className="px-3 py-2 text-left">capability</th>
                <th className="px-3 py-2 text-right">max</th>
                <th className="px-3 py-2 text-left">query</th>
                <th className="px-3 py-2 text-left">id</th>
              </tr>
            </thead>
            <tbody>
              {(recentRequestsLoading ? [] : recentRequests).map((row, index) => {
                const parsed = parseQuerySummary(row.query_summary);
                const maxResultsValue = row.max_results ?? parsed.maxResults;
                return (
                  <tr key={`${row.job_id ?? "job"}-${index}`} className="border-b border-border">
                    <td className="px-3 py-2">{formatClockTime(row.accepted_at)}</td>
                    <td className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2" title={row.capability}>
                      {truncateValue(row.capability, 22)}
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(maxResultsValue)}</td>
                    <td
                      className="max-w-[340px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2"
                      title={parsed.query ?? row.query_summary}
                    >
                      {truncateValue(parsed.query ?? row.query_summary, 96)}
                    </td>
                    <td
                      className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground"
                      title={row.request_id}
                    >
                      {truncateValue(row.request_id, 14)}
                    </td>
                  </tr>
                );
              })}
              {!recentRequestsLoading && recentRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-sm text-muted-foreground">
                    no indexer requests observed yet
                  </td>
                </tr>
              ) : null}
              {recentRequestsLoading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-sm text-muted-foreground">
                    loading recent requests...
                  </td>
                </tr>
              ) : null}
              {recentRequestsLoadingMore ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-sm text-muted-foreground">
                    loading more...
                  </td>
                </tr>
              ) : null}
              {!recentRequestsLoading && !recentRequestsLoadingMore && !recentRequestsHasMore && recentRequests.length > 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-sm text-muted-foreground">
                    end of request log
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="max-h-[42vh] min-h-[260px] overflow-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              workers
            </caption>
            {!workers?.instances?.length ? (
              <tbody>
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-sm text-muted-foreground">
                    no worker instances returned
                  </td>
                </tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">name</th>
                    <th className="px-3 py-2 text-left">status</th>
                    <th className="px-3 py-2 text-right">jobs (1h)</th>
                    <th className="px-3 py-2 text-right">ready ms</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.instances.map((worker) => {
                    const statusText = worker.ready ? "ready" : worker.error || worker.status;
                    const statusColor = worker.ready ? "text-emerald-500" : "text-amber-500";
                    return (
                      <tr key={worker.name} className="border-b border-border">
                        <td className="px-3 py-2 font-semibold">{worker.name}</td>
                        <td className={`px-3 py-2 ${statusColor}`}>{statusText}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(worker.jobsLastHour)}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(worker.readinessLatencyMs)} ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {embedCards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
            Configure health Grafana panel IDs to render charts on `/admin`.
          </div>
        ) : null}
        {embedCards.map((embed) => (
          <div key={embed.key} className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {embed.source ? `${embed.source} · ` : ""}
              {embed.title}
            </p>
            <iframe
              title={`Grafana panel ${embed.panelId}`}
              src={embed.url}
              loading="lazy"
              className="h-[320px] w-full rounded-xl border border-border bg-card"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

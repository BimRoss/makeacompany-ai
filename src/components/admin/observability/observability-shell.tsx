"use client";

import { Suspense, useEffect } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";

import { AdminAgentKillSwitchCompact } from "../admin-agent-kill-switch";
import { AlertsProvider, useAlerts } from "./alerts-provider";
import { AlertsStrip } from "./alerts-strip";
import { CloudflarePanels, useCloudflareSummary } from "./cloudflare-panels";
import { Ga4CountriesPanel, Ga4SourcesPanel, Ga4TopPagesPanel } from "./ga4-panels";
import { ObservabilityDataProvider, useObservabilityData } from "./data-provider";
import { GoldenPath } from "./golden-path";
import { KpiScorecard } from "./kpi-scorecard";
import { MetricPanel } from "./metric-panel";
import { CLUSTER_PANELS, JOBS_PANELS, WEB_PANELS } from "./panels";
import { SearchDeviceStrip, SearchHostsPanel, SearchPagesPanel, SearchQueriesPanel } from "./search-panel";
import { SearchTimeseriesPanels } from "./search-timeseries";
import { ObservabilitySection } from "./section";
import { TimeRangeProvider, useTimeRange } from "./time-range";
import { ObservabilityToolbar } from "./toolbar";

function DashboardLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
    >
      <span>{label}</span>
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

/**
 * Prefix the browser tab title with `(N)` when alerts are firing, so
 * the page draws attention from background tabs. Strips its own prefix
 * on cleanup so the title doesn't carry stale counts.
 */
function useAlertCountInTitle() {
  const { firing } = useAlerts();
  const count = firing.length;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
  }, [count]);
}

function AnomalyBadge({ component }: { component: string }) {
  const { firingByComponent } = useAlerts();
  const count = firingByComponent[component]?.length ?? 0;
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--chart-neg)]"
      title={firingByComponent[component]?.map((a) => a.summary).join("\n")}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {count} firing
    </span>
  );
}

const PANEL_GRID = "grid gap-3 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]";
const WEB_PANEL_GRID = PANEL_GRID;

function ObservabilityBody() {
  useAlertCountInTitle();
  const { loading, lastUpdatedAt, adminDashboardUrl, cronjobDashboardUrl, clusterDashboardUrl } =
    useObservabilityData();
  const { from } = useTimeRange();
  const cloudflare = useCloudflareSummary();
  const cloudflareHasData = (() => {
    const p = cloudflare.payload?.panels;
    if (!p) return false;
    const arrays = [
      p.requestsPerMin,
      p.bandwidthBps,
      p.cacheHitRatio,
      p.statusClass?.reqs2xx,
      p.statusClass?.reqs4xx,
      p.statusClass?.reqs5xx,
    ];
    return arrays.some((a) => (a?.length ?? 0) > 0);
  })();
  const showCloudflare = !cloudflare.errored && (cloudflare.loading || cloudflareHasData);

  const adminDeep = adminDashboardUrl ? appendRange(adminDashboardUrl, from) : null;
  const cronDeep = cronjobDashboardUrl ? appendRange(cronjobDashboardUrl, from) : null;
  const clusterDeep = clusterDashboardUrl ? appendRange(clusterDashboardUrl, from) : null;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <AdminAgentKillSwitchCompact />
        <ObservabilityToolbar lastUpdatedAt={lastUpdatedAt} loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-12">
          <GoldenPath />
        </div>
      </div>

      <KpiScorecard />

      <AlertsStrip />

      <ObservabilitySection
        id="web-tier"
        title="Web tier"
        description="HTTP traffic, latency, errors, and runtime signals from the backend."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="web" />
            <DashboardLink href={adminDeep} label="Open in Grafana" />
          </div>
        }
      >
        <div className={WEB_PANEL_GRID}>
          {WEB_PANELS.map((def) => (
            <MetricPanel key={def.id} def={def} from={from} />
          ))}
        </div>
      </ObservabilitySection>

      <ObservabilitySection
        id="audience"
        title="Audience (GA4)"
        description="Google Analytics 4 — what's happening on the site right now and over the last 7 days."
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          <Ga4TopPagesPanel />
          <Ga4SourcesPanel />
          <Ga4CountriesPanel />
        </div>
      </ObservabilitySection>

      <ObservabilitySection
        id="search"
        title="Search"
        description="Google Search Console — clicks, impressions, CTR, and top organic queries. Pipeline lags ~2 days."
      >
        <div className="space-y-3">
          <SearchTimeseriesPanels />
          <SearchDeviceStrip />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SearchQueriesPanel />
            <SearchPagesPanel />
          </div>
          <SearchHostsPanel />
        </div>
      </ObservabilitySection>

      <ObservabilitySection
        id="background-jobs"
        title="Background jobs"
        description="Snapshot scrapers and K8s CronJob cadence."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="jobs" />
            <DashboardLink href={cronDeep} label="Open in Grafana" />
          </div>
        }
      >
        <div className={PANEL_GRID}>
          {JOBS_PANELS.map((def) => (
            <MetricPanel key={def.id} def={def} from={from} />
          ))}
        </div>
      </ObservabilitySection>

      {showCloudflare ? (
        <ObservabilitySection
          id="edge"
          title="Edge (Cloudflare)"
          description="Cloudflare zone analytics for makeacompany.ai."
        >
          <CloudflarePanels />
        </ObservabilitySection>
      ) : null}

      <ObservabilitySection
        id="cluster"
        title="Cluster"
        description="Kubernetes pod and container health from kube-state-metrics."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="cluster" />
            <DashboardLink href={clusterDeep} label="Open in Grafana" />
          </div>
        }
      >
        <div className={PANEL_GRID}>
          {CLUSTER_PANELS.map((def) => (
            <MetricPanel key={def.id} def={def} from={from} />
          ))}
        </div>
      </ObservabilitySection>
    </div>
  );
}

function appendRange(url: string, from: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("from", from);
    u.searchParams.set("to", "now");
    return u.toString();
  } catch {
    return url;
  }
}

export function AdminObservabilityShell() {
  return (
    <Suspense fallback={null}>
      <TimeRangeProvider>
        <AlertsProvider>
          <ObservabilityDataProvider>
            <ObservabilityBody />
          </ObservabilityDataProvider>
        </AlertsProvider>
      </TimeRangeProvider>
    </Suspense>
  );
}

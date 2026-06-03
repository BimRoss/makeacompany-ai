"use client";

import { Suspense } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";

import { AlertsProvider, useAlerts } from "./alerts-provider";
import { AlertsStrip } from "./alerts-strip";
import { ObservabilityDataProvider, useObservabilityData } from "./data-provider";
import { GoldenPath } from "./golden-path";
import { KpiScorecard } from "./kpi-scorecard";
import { MetricPanel } from "./metric-panel";
import { CLUSTER_PANELS, JOBS_PANELS, WEB_PANELS } from "./panels";
import { SearchQueriesPanel } from "./search-panel";
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

const PANEL_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

function ObservabilityBody() {
  const { loading, lastUpdatedAt, adminDashboardUrl, cronjobDashboardUrl, clusterDashboardUrl } =
    useObservabilityData();
  const { from } = useTimeRange();

  const adminDeep = adminDashboardUrl ? appendRange(adminDashboardUrl, from) : null;
  const cronDeep = cronjobDashboardUrl ? appendRange(cronjobDashboardUrl, "now-24h") : null;
  const clusterDeep = clusterDashboardUrl ? appendRange(clusterDashboardUrl, "now-24h") : null;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 space-y-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
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
        <div className={PANEL_GRID}>
          {WEB_PANELS.map((def) => (
            <MetricPanel key={def.id} def={def} from={from} />
          ))}
        </div>
      </ObservabilitySection>

      <ObservabilitySection
        id="search"
        title="Search"
        description="Google Search Console — clicks, impressions, CTR, and top organic queries. Pipeline lags ~2 days."
      >
        <div className="space-y-3">
          <SearchTimeseriesPanels />
          <SearchQueriesPanel />
        </div>
      </ObservabilitySection>

      <ObservabilitySection
        id="background-jobs"
        title="Background jobs"
        description="Snapshot scrapers and K8s CronJob cadence. Fixed to 24h to capture full schedules."
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

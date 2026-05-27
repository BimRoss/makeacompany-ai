"use client";

import { Suspense, useCallback, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { AlertsProvider, useAlerts } from "./alerts-provider";
import { AlertsStrip } from "./alerts-strip";
import {
  ObservabilityDataProvider,
  useObservabilityData,
} from "./data-provider";
import { GrafanaGrid } from "./grafana-grid";
import { KpiScorecard, type KpiSelfCheckEntry } from "./kpi-scorecard";
import { ObservabilitySection } from "./section";
import { SelfCheckBanner } from "./self-check-banner";
import { TimeRangeProvider, useTimeRange } from "./time-range";
import { ObservabilityToolbar } from "./toolbar";

function DashboardLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <span>{label}</span>
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function AnomalyBadge({ component }: { component: string }) {
  const { firingByComponent } = useAlerts();
  const count = firingByComponent[component]?.length ?? 0;
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300"
      title={firingByComponent[component]?.map((a) => a.summary).join("\n")}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {count} firing
    </span>
  );
}

// Chart grids: at narrow widths (49" 1/3 window ≈ 1700px) keep 2 columns;
// only fan out to 3-4 on truly wide displays. Each card uses @container so
// inner content can reflow independently of viewport breakpoints.
const WEB_TIER_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4";
const JOBS_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3";
const CLUSTER_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3";

function ObservabilityBody() {
  const { loading, lastUpdatedAt, adminDashboardUrl, cronjobDashboardUrl, clusterDashboardUrl } =
    useObservabilityData();
  const { from } = useTimeRange();
  const [selfCheck, setSelfCheck] = useState<KpiSelfCheckEntry[]>([]);
  const handleSelfCheck = useCallback((entries: KpiSelfCheckEntry[]) => {
    setSelfCheck(entries);
  }, []);

  const adminDeep = adminDashboardUrl ? appendRange(adminDashboardUrl, from) : null;
  const cronDeep = cronjobDashboardUrl ? appendRange(cronjobDashboardUrl, from) : null;
  const clusterDeep = clusterDashboardUrl ? appendRange(clusterDashboardUrl, from) : null;

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-4 space-y-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <ObservabilityToolbar lastUpdatedAt={lastUpdatedAt} loading={loading} />
        <KpiScorecard onSelfCheck={handleSelfCheck} />
      </div>
      <SelfCheckBanner entries={selfCheck} />
      <AlertsStrip />
      <ObservabilitySection
        id="web-tier"
        title="Web tier"
        description="HTTP traffic, latency, errors, and runtime signals from the backend."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="web" />
            <DashboardLink href={adminDeep} label="Open dashboard" />
          </div>
        }
      >
        <GrafanaGrid
          source="admin"
          skeletonCount={6}
          gridClassName={WEB_TIER_GRID}
          panelHeight="sm"
        />
      </ObservabilitySection>
      <ObservabilitySection
        id="background-jobs"
        title="Background jobs"
        description="K8s CronJob and scraper run-state. Time range fixed to 24h to capture full schedules."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="jobs" />
            <DashboardLink href={cronDeep} label="Open dashboard" />
          </div>
        }
      >
        <GrafanaGrid
          source="cronjob"
          skeletonCount={3}
          gridClassName={JOBS_GRID}
          panelHeight="md"
          forceFrom="now-24h"
        />
      </ObservabilitySection>
      <ObservabilitySection
        id="cluster"
        title="Cluster"
        description="Kubernetes pod and container health from kube-state-metrics."
        endSlot={
          <div className="flex items-center gap-2">
            <AnomalyBadge component="cluster" />
            <DashboardLink href={clusterDeep} label="Open dashboard" />
          </div>
        }
      >
        <GrafanaGrid
          source="cluster"
          skeletonCount={5}
          gridClassName={CLUSTER_GRID}
          panelHeight="md"
          forceFrom="now-24h"
        />
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

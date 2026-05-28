"use client";

import { Suspense } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { AlertsProvider, useAlerts } from "./alerts-provider";
import { AlertsStrip } from "./alerts-strip";
import {
  ObservabilityDataProvider,
  useObservabilityData,
} from "./data-provider";
import { GrafanaGrid } from "./grafana-grid";
import { KpiScorecard } from "./kpi-scorecard";
import { ObservabilitySection } from "./section";
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

function ObservabilityBody() {
  const { loading, lastUpdatedAt, adminDashboardUrl, cronjobDashboardUrl, clusterDashboardUrl } =
    useObservabilityData();
  const { from } = useTimeRange();

  const adminDeep = adminDashboardUrl ? appendRange(adminDashboardUrl, from) : null;
  const cronDeep = cronjobDashboardUrl ? appendRange(cronjobDashboardUrl, from) : null;
  const clusterDeep = clusterDashboardUrl ? appendRange(clusterDashboardUrl, from) : null;

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-20 -mx-4 space-y-1.5 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ObservabilityToolbar lastUpdatedAt={lastUpdatedAt} loading={loading} />
        <KpiScorecard />
      </div>
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
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4"
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
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2 min-[1800px]:grid-cols-3"
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
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-3"
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

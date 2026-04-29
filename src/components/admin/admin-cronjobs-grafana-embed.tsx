"use client";

import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";

/** K8s CronJob / Job panels (Grafana) — below “All agents (goroutines)” on `/admin`, same card styling. */
export function AdminCronJobsGrafanaEmbed() {
  return (
    <ServiceGrafanaDashboard
      embedsKey="cronjobGrafanaEmbeds"
      title="Kubernetes CronJobs"
      titleAs="h2"
      description="Scrapers and batch jobs: schedule, outcome, and duration. Point panels at a dashboard backed by kube-state-metrics / Prometheus (see HEALTH_GRAFANA_CRON_*)."
      gridClassName="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
    />
  );
}

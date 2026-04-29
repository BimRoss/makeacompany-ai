"use client";

import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";

/** K8s CronJob / Job panels (Grafana) — below “All agents (goroutines)” on `/admin`, same card styling. */
export function AdminCronJobsGrafanaEmbed() {
  return (
    <ServiceGrafanaDashboard
      embedsKey="cronjobGrafanaEmbeds"
      title="CronJobs"
      titleAs="h2"
      gridClassName="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
    />
  );
}

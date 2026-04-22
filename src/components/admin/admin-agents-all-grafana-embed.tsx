"use client";

import { ServiceGrafanaDashboard } from "@/components/admin/service-grafana-dashboard";

/** Full-width “All agents (goroutines)” panel from the agents dashboard — belongs on `/admin`, not on per-employee cards. */
export function AdminAgentsAllGrafanaEmbed() {
  return (
    <ServiceGrafanaDashboard
      embedsKey="agentsGrafanaEmbeds"
      embedFilter={(embed) => /all agents/i.test(embed.title) || embed.panelId === "2"}
      gridClassName="grid grid-cols-1 gap-2"
    />
  );
}

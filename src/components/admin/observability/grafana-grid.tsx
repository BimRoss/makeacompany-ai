"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";

import { PanelCard, PanelSkeleton } from "./panel-card";
import { useObservabilityData, type GrafanaEmbed } from "./data-provider";
import { useTimeRange } from "./time-range";
import { asGrafanaDashboardDeepLink, asGrafanaSoloEmbedUrl } from "./grafana-url";

type GrafanaGridProps = {
  source: "admin" | "cronjob" | "cluster";
  /** Slot count for skeleton render before first fetch. */
  skeletonCount: number;
  gridClassName: string;
  panelHeight?: "sm" | "md";
  /** Optional client-side filter (e.g. hide panelId 2 on cron). */
  embedFilter?: (embed: GrafanaEmbed) => boolean;
  /** Overrides the time-range "from" for this grid (e.g. cron defaults longer). */
  forceFrom?: string;
};

export function GrafanaGrid({
  source,
  skeletonCount,
  gridClassName,
  panelHeight = "sm",
  embedFilter,
  forceFrom,
}: GrafanaGridProps) {
  const { resolvedTheme } = useTheme();
  const { loopback, fetched, adminEmbeds, cronjobEmbeds, clusterEmbeds } = useObservabilityData();
  const { from } = useTimeRange();

  const raw =
    source === "admin"
      ? adminEmbeds
      : source === "cronjob"
        ? cronjobEmbeds
        : clusterEmbeds;
  const filtered = useMemo(
    () => (embedFilter ? raw.filter(embedFilter) : raw),
    [raw, embedFilter]
  );

  const effectiveFrom = forceFrom ?? from;
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const cards = useMemo(
    () =>
      filtered
        .map((embed) => ({
          key: embed.key,
          title: embed.title,
          src: asGrafanaSoloEmbedUrl(embed.dashboardUrl, embed.panelId, theme, effectiveFrom),
          deepLink: asGrafanaDashboardDeepLink(embed.dashboardUrl, embed.panelId, effectiveFrom),
        }))
        .filter((c): c is { key: string; title: string; src: string; deepLink: string | null } =>
          Boolean(c.src)
        ),
    [filtered, theme, effectiveFrom]
  );

  if (loopback === null) {
    return null;
  }
  if (loopback && fetched && cards.length === 0) {
    return null;
  }

  if (!fetched) {
    return (
      <div className={gridClassName}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <PanelSkeleton key={`skeleton-${source}-${i}`} height={panelHeight} />
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        No Grafana panels resolved. Set the matching{" "}
        <code className="text-[11px]">HEALTH_GRAFANA_*</code> env vars and reload.
      </p>
    );
  }

  return (
    <div className={gridClassName}>
      {cards.map((c) => (
        <PanelCard
          key={c.key}
          title={c.title}
          iframeSrc={c.src}
          deepLink={c.deepLink}
          height={panelHeight}
        />
      ))}
    </div>
  );
}

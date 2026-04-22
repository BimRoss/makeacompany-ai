"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
};

type HealthPayload = {
  adminGrafanaEmbeds?: GrafanaEmbed[];
};

type PreparedEmbed = {
  key: string;
  title: string;
  panelId: string;
  url: string;
};

const EXPECTED_ADMIN_PANELS = 8;

const RECOMMENDED_OVERVIEW_TITLES = [
  "Requests /min",
  "P95 latency",
  "Inbound events by agent",
  "Activities",
  "JetStream publish /s",
  "Worker orchestrator ingress",
  "Orchestrator Socket Mode",
  "Backend HTTP errors/min",
];

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

export function AdminOverviewGrafanaGrid() {
  const { resolvedTheme } = useTheme();
  const [embeds, setEmbeds] = useState<GrafanaEmbed[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        const payload = (await response.json()) as HealthPayload;
        if (!cancelled) {
          setEmbeds(Array.isArray(payload.adminGrafanaEmbeds) ? payload.adminGrafanaEmbeds : []);
        }
      } catch {
        if (!cancelled) {
          setEmbeds([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () =>
      embeds
        .slice(0, EXPECTED_ADMIN_PANELS)
        .map((embed) => ({
          key: embed.key,
          title: embed.title,
          panelId: embed.panelId,
          url: asGrafanaEmbedUrl(embed.dashboardUrl, embed.panelId, resolvedTheme === "dark" ? "dark" : "light"),
        }))
        .filter((item): item is PreparedEmbed => Boolean(item.url)),
    [embeds, resolvedTheme]
  );

  const missing = Math.max(0, EXPECTED_ADMIN_PANELS - cards.length);

  return (
    <section className="rounded-none bg-card px-0 pb-3 pt-3 sm:rounded-2xl sm:pb-4 sm:pt-4">
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-2 xl:grid-cols-4">
        {cards.map((embed) => (
          <article
            key={embed.key}
            className="overflow-hidden rounded-none border border-border bg-background/60 sm:rounded-xl"
          >
            <iframe title={embed.title} src={embed.url} loading="lazy" className="h-48 w-full border-0 bg-card" />
          </article>
        ))}
        {Array.from({ length: missing }).map((_, index) => {
          const suggestionTitle = RECOMMENDED_OVERVIEW_TITLES[cards.length + index] ?? `Panel ${cards.length + index + 1}`;
          return (
            <article
              key={`missing-admin-panel-${index}`}
              className="flex h-60 items-center justify-center rounded-none border border-dashed border-border bg-background/60 p-4 text-center sm:rounded-xl"
            >
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{suggestionTitle}</p>
                <p className="text-xs text-muted-foreground">
                  Set <code className="text-[11px]">HEALTH_GRAFANA_LOCAL_BASE_URL</code> (e.g.{" "}
                  <code className="text-[11px]">http://127.0.0.1:13000</code> with Grafana port-forward) or{" "}
                  <code className="text-[11px]">HEALTH_GRAFANA_DASHBOARD_URL</code>. Panel ids default from the server when a
                  dashboard base exists.
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

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
  "Request throughput",
  "P95 latency",
  "Error rate",
  "Success vs error",
  "Queue depth",
  "Worker readiness",
  "Tool mix",
  "Webhook latency",
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
    const intervalID = setInterval(() => {
      void load();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(intervalID);
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
    <section className="space-y-3 rounded-2xl bg-card px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Service overview</h2>
        <p className="text-xs text-muted-foreground">
          High-level health tiles. Keep each panel to one clear signal with a short legend.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((embed) => (
          <article key={embed.key} className="overflow-hidden rounded-xl border border-border bg-background/60">
            <iframe title={embed.title} src={embed.url} loading="lazy" className="h-48 w-full border-0 bg-card" />
          </article>
        ))}
        {Array.from({ length: missing }).map((_, index) => {
          const suggestionTitle = RECOMMENDED_OVERVIEW_TITLES[cards.length + index] ?? `Panel ${cards.length + index + 1}`;
          return (
            <article
              key={`missing-admin-panel-${index}`}
              className="flex h-60 items-center justify-center rounded-xl border border-dashed border-border bg-background/60 p-4 text-center"
            >
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{suggestionTitle}</p>
                <p className="text-xs text-muted-foreground">
                  Configure `HEALTH_GRAFANA_ADMIN_PANEL_IDS` and `HEALTH_GRAFANA_ADMIN_PANEL_TITLES`.
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
};

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

type ServiceGrafanaDashboardProps = {
  /** Key on /api/admin/health JSON (e.g. slackOrchestratorGrafanaEmbeds) */
  embedsKey: "slackOrchestratorGrafanaEmbeds" | "agentsGrafanaEmbeds";
  title: string;
  description: string;
  gridClassName?: string;
};

export function ServiceGrafanaDashboard({
  embedsKey,
  title,
  description,
  gridClassName = "grid grid-cols-1 gap-2 md:grid-cols-2",
}: ServiceGrafanaDashboardProps) {
  const { resolvedTheme } = useTheme();
  const [embeds, setEmbeds] = useState<GrafanaEmbed[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        const payload = (await response.json()) as Record<string, GrafanaEmbed[] | undefined>;
        const list = payload[embedsKey];
        if (!cancelled) {
          setEmbeds(Array.isArray(list) ? list : []);
        }
      } catch {
        if (!cancelled) {
          setEmbeds([]);
        }
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [embedsKey]);

  const cards = useMemo(
    () =>
      embeds
        .map((embed) => ({
          key: embed.key,
          title: embed.title,
          url: asGrafanaEmbedUrl(embed.dashboardUrl, embed.panelId, resolvedTheme === "dark" ? "dark" : "light"),
        }))
        .filter((c): c is typeof c & { url: string } => Boolean(c.url)),
    [embeds, resolvedTheme]
  );

  return (
    <section className="space-y-3">
      <div className="space-y-1 px-0.5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className={gridClassName}>
        {cards.map((c) => (
          <article
            key={c.key}
            className="overflow-hidden rounded-xl border border-border bg-background/60 shadow-sm"
          >
            <header className="border-b border-border/80 bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.title}</p>
            </header>
            <iframe title={c.title} src={c.url} loading="lazy" className="h-52 w-full border-0 bg-card md:h-56" />
          </article>
        ))}
      </div>
      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No Grafana panels configured for this service. Set the matching <code className="text-xs">HEALTH_GRAFANA_*</code>{" "}
          env vars and reload.
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

import { isBrowserLoopbackHost } from "@/lib/admin/browser-loopback";
import { kickToLoginForUnauthorizedApi } from "@/lib/client-auth-unauthorized-redirect";

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
  embedsKey: "slackOrchestratorGrafanaEmbeds" | "agentsGrafanaEmbeds" | "cronjobGrafanaEmbeds";
  /** Optional; omit to show only Grafana embeds (panel titles come from Grafana). */
  title?: string;
  description?: string;
  gridClassName?: string;
  /** When set, only matching panels are rendered (e.g. “All agents” on `/admin`). */
  embedFilter?: (embed: GrafanaEmbed) => boolean;
  /** Use `h2` when embedding under a page that already has a primary `h1` (e.g. `/admin`). */
  titleAs?: "h1" | "h2";
};

export function ServiceGrafanaDashboard({
  embedsKey,
  title,
  description,
  gridClassName = "grid grid-cols-1 gap-2 md:grid-cols-2",
  embedFilter,
  titleAs = "h1",
}: ServiceGrafanaDashboardProps) {
  const { resolvedTheme } = useTheme();
  const [loopback, setLoopback] = useState<boolean | null>(null);
  const [embeds, setEmbeds] = useState<GrafanaEmbed[]>([]);
  const [healthFetched, setHealthFetched] = useState(false);

  useEffect(() => {
    setLoopback(isBrowserLoopbackHost());
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        if (kickToLoginForUnauthorizedApi(response.status, "admin")) {
          return;
        }
        const payload = (await response.json()) as Record<string, GrafanaEmbed[] | undefined>;
        const list = payload[embedsKey];
        if (!cancelled) {
          setEmbeds(Array.isArray(list) ? list : []);
        }
      } catch {
        if (!cancelled) {
          setEmbeds([]);
        }
      } finally {
        if (!cancelled) {
          setHealthFetched(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [embedsKey]);

  const filteredEmbeds = useMemo(
    () => (embedFilter ? embeds.filter(embedFilter) : embeds),
    [embeds, embedFilter]
  );

  const cards = useMemo(
    () =>
      filteredEmbeds
        .map((embed) => ({
          key: embed.key,
          title: embed.title,
          url: asGrafanaEmbedUrl(embed.dashboardUrl, embed.panelId, resolvedTheme === "dark" ? "dark" : "light"),
        }))
        .filter((c): c is typeof c & { url: string } => Boolean(c.url)),
    [filteredEmbeds, resolvedTheme]
  );

  const showPageHeading = Boolean(title?.trim() || description?.trim());

  if (loopback === null) {
    return null;
  }

  if (loopback && !healthFetched) {
    return null;
  }

  if (loopback && healthFetched && cards.length === 0) {
    return null;
  }

  const TitleTag = titleAs;

  if (!healthFetched) {
    return (
      <section className="space-y-3">
        {showPageHeading ? (
          <div className="space-y-1 px-0.5">
            {title?.trim() ? (
              <TitleTag className="font-display text-xl font-semibold tracking-tight text-foreground">{title}</TitleTag>
            ) : null}
            {description?.trim() ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        ) : null}
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Loading observability panels…
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {showPageHeading ? (
        <div className="space-y-1 px-0.5">
          {title?.trim() ? (
            <TitleTag className="font-display text-xl font-semibold tracking-tight text-foreground">{title}</TitleTag>
          ) : null}
          {description?.trim() ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={gridClassName}>
        {cards.map((c) => (
          <article
            key={c.key}
            className="overflow-hidden rounded-xl border border-border bg-background/60 shadow-sm"
          >
            <iframe title={c.title} src={c.url} loading="lazy" className="h-56 w-full border-0 bg-card md:h-60" />
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

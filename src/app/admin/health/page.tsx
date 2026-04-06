"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/admin-shell";

import styles from "./health.module.css";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
};

type HealthPayload = {
  checkedAt?: string;
  error?: string;
  grafanaEmbeds?: GrafanaEmbed[];
};

function asGrafanaEmbedUrl(value?: string | null, panelId: string = "1"): string | null {
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
    url.searchParams.set("theme", "light");
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

function formatDateTime(value?: string): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminHealthPage() {
  const [payload, setPayload] = useState<HealthPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        const data = (await response.json()) as HealthPayload;
        if (!cancelled) {
          setPayload(data);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (!cancelled) {
          setPayload({
            error: message,
            checkedAt: new Date().toISOString(),
          });
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

  const embeds = useMemo(
    () =>
      (payload?.grafanaEmbeds ?? []).map((embed) => ({
        ...embed,
        url: asGrafanaEmbedUrl(embed.dashboardUrl, embed.panelId),
      })),
    [payload?.grafanaEmbeds]
  );
  const updatedAt = payload?.checkedAt ? formatDateTime(payload.checkedAt) : "Waiting for first poll…";

  return (
    <AdminShell activeTab="health">
      <section className={styles.layout}>
        {payload?.error ? (
          <div className={styles.errorBanner}>
            Health API returned degraded status at {updatedAt}: {payload.error}
          </div>
        ) : null}

        <div className={styles.grid}>
          {embeds.length === 0 ? (
            <div className={styles.placeholder}>
              Configure `HEALTH_GRAFANA_DASHBOARD_URL`, `HEALTH_GRAFANA_PANEL_IDS`, and
              `HEALTH_GRAFANA_PANEL_TITLES` to render this page.
            </div>
          ) : null}

          {embeds.map((embed) => (
            <article key={embed.key} className={styles.panel}>
              <h2 className={styles.panelTitle}>{embed.title}</h2>
              {embed.url ? (
                <iframe title={embed.title} src={embed.url} className={styles.iframe} />
              ) : (
                <div className={styles.placeholder}>Could not build embed URL for panel {embed.panelId}.</div>
              )}
            </article>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
